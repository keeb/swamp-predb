import { z } from "npm:zod@4";

// PreDB.net API — https://predb.net/api-documentation/
// GET-only, no auth, 30 requests / 60s, limit 1-100, page 1-1000.
const API_URL = "https://api.predb.net/";
const REQUEST_SPACING_MS = 2100;

const GlobalArgsSchema = z.object({
  baseUrl: z.string().default(API_URL).describe("PreDB API base URL"),
});

// status codes from the API docs
const STATUS_NAMES = ["ok", "nuked", "unnuked", "delpre", "undelpre"] as const;
// releases that are currently usable: ok, unnuked, undelpre
const LIVE_STATUSES = new Set([0, 2, 4]);

const LANGUAGE_TAGS = new Set([
  "MULTI",
  "DUAL",
  "DL",
  "FRENCH",
  "SUBFRENCH",
  "TRUEFRENCH",
  "VFF",
  "VFQ",
  "VOSTFR",
  "GERMAN",
  "POLISH",
  "PL",
  "CZECH",
  "SLOVAK",
  "DANISH",
  "SWEDISH",
  "NORWEGIAN",
  "FINNISH",
  "NORDIC",
  "DUTCH",
  "FLEMISH",
  "ITALIAN",
  "SPANISH",
  "CASTELLANO",
  "LATIN",
  "PORTUGUESE",
  "BRAZILIAN",
  "RUSSIAN",
  "UKRAINIAN",
  "HUNGARIAN",
  "ROMANIAN",
  "GREEK",
  "TURKISH",
  "HEBREW",
  "ARABIC",
  "HINDI",
  "JAPANESE",
  "KOREAN",
  "CHINESE",
  "MANDARIN",
  "CANTONESE",
  "THAI",
  "ICELANDIC",
  "ESTONIAN",
  "LATVIAN",
  "LITHUANIAN",
  "BULGARIAN",
  "CROATIAN",
  "SERBIAN",
  "SLOVENIAN",
  "SUBBED",
  "DUBBED",
]);
const SOURCE_TAGS = new Set([
  "WEB",
  "WEBRIP",
  "WEB-DL",
  "WEBDL",
  "HDTV",
  "PDTV",
  "SDTV",
  "DSR",
  "AHDTV",
  "UHDTV",
  "BLURAY",
  "BDRIP",
  "BRRIP",
  "DVDRIP",
  "DVDR",
  "COMPLETE",
]);
const CODEC_TAGS = new Set([
  "H264",
  "X264",
  "H265",
  "X265",
  "HEVC",
  "AVC",
  "XVID",
  "AV1",
  "VC1",
  "MPEG2",
]);
const HDR_TAGS = new Set(["HDR", "HDR10", "HDR10PLUS", "DV", "DOVI"]);
const FLAG_TAGS = new Set([
  "PROPER",
  "REPACK",
  "RERIP",
  "REAL",
  "INTERNAL",
  "FINAL",
  "READNFO",
  "DIRFIX",
  "NFOFIX",
  "SAMPLEFIX",
  "SUBFIX",
  "SYNCFIX",
]);

const ParsedSchema = z.object({
  show: z.string().nullable(),
  season: z.number().nullable(),
  episodes: z.array(z.number()),
  seasonPack: z.boolean(),
  resolution: z.string().nullable(),
  source: z.string().nullable(),
  codec: z.string().nullable(),
  hdr: z.array(z.string()),
  languages: z.array(z.string()),
  foreign: z.boolean(),
  flags: z.array(z.string()),
});

const ReleaseSchema = z.object({
  release: z.string(),
  group: z.string(),
  section: z.string(),
  genre: z.string(),
  pretime: z.number(),
  preAt: z.string(),
  files: z.number(),
  sizeMb: z.number(),
  status: z.number(),
  statusName: z.string(),
  reason: z.string(),
  url: z.string(),
  nfo: z.string().optional(),
  nfoImage: z.string().optional(),
  parsed: ParsedSchema,
});

const SearchSchema = z.object({
  params: z.record(z.string(), z.string()),
  fetchedAt: z.string(),
  pages: z.number(),
  count: z.number(),
  releases: z.array(ReleaseSchema),
});

const ReleaseLookupSchema = z.object({
  release: z.string(),
  found: z.boolean(),
  fetchedAt: z.string(),
  pre: ReleaseSchema.nullable(),
});

const NfoSchema = z.object({
  release: z.string(),
  found: z.boolean(),
  fetchedAt: z.string(),
  nfoUrl: z.string().nullable(),
  nfoImageUrl: z.string().nullable(),
  content: z.string().nullable(),
});

const StatsSchema = z.object({
  kind: z.string(),
  target: z.string().nullable(),
  fetchedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const VariantSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  languages: z.array(z.string()),
  foreign: z.boolean(),
  resolution: z.string().nullable(),
  source: z.string().nullable(),
  codec: z.string().nullable(),
  hdr: z.array(z.string()),
  complete: z.boolean(),
  episodes: z.array(z.number()),
  missing: z.array(z.number()),
  nuked: z.array(z.object({
    episode: z.number().nullable(),
    release: z.string(),
    reason: z.string(),
  })),
  seasonPacks: z.array(z.string()),
  totalSizeMb: z.number(),
  firstPreAt: z.string(),
  lastPreAt: z.string(),
  releases: z.array(z.string()),
});

const CoverageSchema = z.object({
  show: z.string(),
  season: z.number(),
  query: z.string(),
  fetchedAt: z.string(),
  pages: z.number(),
  releaseCount: z.number(),
  episodeCount: z.number(),
  episodeCountSource: z.enum(["argument", "final-tag", "max-seen", "none"]),
  episodesSeen: z.array(z.number()),
  complete: z.array(z.string()),
  groups: z.array(z.object({
    group: z.string(),
    complete: z.boolean(),
    variants: z.number(),
    episodes: z.array(z.number()),
    missing: z.array(z.number()),
  })),
  variants: z.array(VariantSchema),
});

type Release = z.infer<typeof ReleaseSchema>;
type Parsed = z.infer<typeof ParsedSchema>;
type Variant = z.infer<typeof VariantSchema>;

// deno-lint-ignore no-explicit-any
type Logger = any;

/** Lowercase, hyphen-separated form of a string for instance names. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeShow(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * Parse a scene release name into show/season/episode and quality tags.
 * Unknown tokens after the SxxEyy marker are treated as episode title words.
 */
export function parseRelease(name: string): Parsed {
  const parsed: Parsed = {
    show: null,
    season: null,
    episodes: [],
    seasonPack: false,
    resolution: null,
    source: null,
    codec: null,
    hdr: [],
    languages: [],
    foreign: false,
    flags: [],
  };

  // strip the -GROUP suffix
  const dash = name.lastIndexOf("-");
  const body = dash > 0 ? name.slice(0, dash) : name;

  const m = body.match(
    /^(.+?)[._ ]S(\d{1,3})((?:[._-]?E\d{1,4})*)(?=[._ ]|$)(.*)$/i,
  );
  let rest = body;
  if (m) {
    parsed.show = m[1].replace(/[._]+/g, " ").trim();
    parsed.season = Number(m[2]);
    const eps = [...m[3].matchAll(/E(\d{1,4})/gi)].map((e) => Number(e[1]));
    if (eps.length === 0) {
      parsed.seasonPack = true;
    } else if (eps.length === 2 && /-E/i.test(m[3]) && eps[1] > eps[0]) {
      parsed.episodes = range(eps[0], eps[1]);
    } else {
      parsed.episodes = [...new Set(eps)].sort((a, b) => a - b);
    }
    rest = m[4];
  }

  for (const raw of rest.split(/[._ ]+/).filter(Boolean)) {
    const tok = raw.toUpperCase();
    if (/^\d{3,4}[PI]$/.test(tok)) parsed.resolution = raw.toLowerCase();
    else if (tok === "UHD" && !parsed.resolution) parsed.resolution = "2160p";
    else if (SOURCE_TAGS.has(tok)) parsed.source ??= tok;
    else if (CODEC_TAGS.has(tok)) parsed.codec ??= tok;
    else if (HDR_TAGS.has(tok)) parsed.hdr.push(tok);
    else if (LANGUAGE_TAGS.has(tok)) parsed.languages.push(tok);
    else if (FLAG_TAGS.has(tok)) parsed.flags.push(tok);
  }
  parsed.foreign = parsed.languages.length > 0;
  return parsed;
}

/** Map a raw PreDB API release object to the stored release shape. */
// deno-lint-ignore no-explicit-any
export function mapRelease(r: any): Release {
  const status = Number(r.status ?? 0);
  return {
    release: String(r.release),
    group: String(r.group ?? ""),
    section: String(r.section ?? ""),
    genre: String(r.genre ?? ""),
    pretime: Number(r.pretime ?? 0),
    preAt: new Date(Number(r.pretime ?? 0) * 1000).toISOString(),
    files: Number(r.files ?? 0),
    sizeMb: Number(r.size ?? 0),
    status,
    statusName: STATUS_NAMES[status] ?? `unknown-${status}`,
    reason: String(r.reason ?? ""),
    url: new URL(String(r.url ?? ""), "https://predb.net").href,
    nfo: r.nfo || undefined,
    nfoImage: r.nfo_img || undefined,
    parsed: parseRelease(String(r.release)),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(
  baseUrl: string,
  params: Record<string, string>,
  logger: Logger,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = `${baseUrl}?${new URLSearchParams(params)}`;
  for (let attempt = 1;; attempt++) {
    logger.info("GET {url}", { url });
    const res = await fetch(url);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await res.body?.cancel();
      const wait = res.status === 429 ? 60_000 : 5_000 * attempt;
      logger.warning("PreDB returned {status}, retrying in {wait}ms", {
        status: res.status,
        wait,
      });
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`PreDB API error: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (json.status !== "success") {
      throw new Error(`PreDB API error: ${json.message || "unknown error"}`);
    }
    return json;
  }
}

/** Fetch every page of a search, deduped by release name. */
async function searchAll(
  baseUrl: string,
  params: Record<string, string>,
  maxPages: number,
  logger: Logger,
): Promise<{ releases: Release[]; pages: number }> {
  const limit = Number(params.limit ?? "100");
  const seen = new Map<string, Release>();
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(REQUEST_SPACING_MS);
    const json = await apiGet(
      baseUrl,
      { ...params, page: String(page) },
      logger,
    );
    pages = page;
    const data = Array.isArray(json.data) ? json.data : [];
    for (const r of data) seen.set(String(r.release), mapRelease(r));
    if (data.length < limit) break;
    if (page === maxPages) {
      logger.warning("Stopped at maxPages={maxPages}; results may be partial", {
        maxPages,
      });
    }
  }
  return { releases: [...seen.values()], pages };
}

function variantKey(r: Release): string {
  const p = r.parsed;
  return [
    r.group,
    p.languages.join("+"),
    p.resolution ?? "sd",
    p.source ?? "",
    p.codec ?? "",
    p.hdr.join("+"),
  ].join("|").toLowerCase();
}

function variantLabel(r: Release): string {
  const p = r.parsed;
  return [
    r.group,
    ...p.languages,
    ...p.hdr,
    p.resolution ?? "SD",
    p.source,
    p.codec,
  ].filter(Boolean).join(" ");
}

/**
 * Group a season's releases into per-group quality variants and work out
 * which variants cover every episode. Nuked/delpre'd releases don't count.
 */
export function buildCoverage(
  releases: Release[],
  show: string,
  season: number,
  episodeCountArg?: number,
): Pick<
  z.infer<typeof CoverageSchema>,
  | "episodeCount"
  | "episodeCountSource"
  | "episodesSeen"
  | "complete"
  | "groups"
  | "variants"
> {
  const wanted = normalizeShow(show);
  const matching = releases.filter((r) =>
    r.parsed.show !== null && normalizeShow(r.parsed.show) === wanted &&
    r.parsed.season === season
  );

  const seenEps = new Set<number>();
  let finalEp: number | null = null;
  for (const r of matching) {
    for (const e of r.parsed.episodes) seenEps.add(e);
    if (r.parsed.flags.includes("FINAL") && r.parsed.episodes.length > 0) {
      finalEp = Math.max(finalEp ?? 0, ...r.parsed.episodes);
    }
  }
  const episodesSeen = [...seenEps].sort((a, b) => a - b);

  let episodeCount: number;
  let episodeCountSource: "argument" | "final-tag" | "max-seen" | "none";
  if (episodeCountArg) {
    episodeCount = episodeCountArg;
    episodeCountSource = "argument";
  } else if (finalEp !== null) {
    episodeCount = finalEp;
    episodeCountSource = "final-tag";
  } else if (episodesSeen.length > 0) {
    episodeCount = episodesSeen[episodesSeen.length - 1];
    episodeCountSource = "max-seen";
  } else {
    episodeCount = 0;
    episodeCountSource = "none";
  }
  const all = range(1, episodeCount);

  const byVariant = new Map<string, Release[]>();
  for (const r of matching) {
    const k = variantKey(r);
    byVariant.set(k, [...(byVariant.get(k) ?? []), r]);
  }

  const variants: Variant[] = [];
  for (const [key, rels] of byVariant) {
    rels.sort((a, b) => a.pretime - b.pretime);
    const live = rels.filter((r) => LIVE_STATUSES.has(r.status));
    const seasonPacks = live.filter((r) => r.parsed.seasonPack).map((r) =>
      r.release
    );
    const eps = new Set<number>();
    for (const r of live) for (const e of r.parsed.episodes) eps.add(e);
    if (seasonPacks.length > 0) { for (const e of all) eps.add(e); }
    const episodes = [...eps].sort((a, b) => a - b);
    const missing = all.filter((e) => !eps.has(e));
    const first = rels[0];
    variants.push({
      key,
      label: variantLabel(first),
      group: first.group,
      languages: first.parsed.languages,
      foreign: first.parsed.foreign,
      resolution: first.parsed.resolution,
      source: first.parsed.source,
      codec: first.parsed.codec,
      hdr: first.parsed.hdr,
      complete: episodeCount > 0 && missing.length === 0,
      episodes,
      missing,
      nuked: rels.filter((r) => !LIVE_STATUSES.has(r.status)).map((r) => ({
        episode: r.parsed.episodes[0] ?? null,
        release: r.release,
        reason: r.reason || r.statusName,
      })),
      seasonPacks,
      totalSizeMb: Math.round(live.reduce((s, r) => s + r.sizeMb, 0)),
      firstPreAt: first.preAt,
      lastPreAt: rels[rels.length - 1].preAt,
      releases: rels.map((r) => r.release),
    });
  }
  variants.sort((a, b) =>
    Number(b.complete) - Number(a.complete) ||
    Number(a.foreign) - Number(b.foreign) ||
    b.episodes.length - a.episodes.length ||
    a.label.localeCompare(b.label)
  );

  const groupMap = new Map<string, Variant[]>();
  for (const v of variants) {
    groupMap.set(v.group, [...(groupMap.get(v.group) ?? []), v]);
  }
  const groups = [...groupMap].map(([group, vs]) => {
    const eps = new Set(vs.flatMap((v) => v.episodes));
    return {
      group,
      complete: vs.some((v) => v.complete),
      variants: vs.length,
      episodes: [...eps].sort((a, b) => a - b),
      missing: all.filter((e) => !eps.has(e)),
    };
  });

  return {
    episodeCount,
    episodeCountSource,
    episodesSeen,
    complete: variants.filter((v) => v.complete).map((v) => v.label),
    groups,
    variants,
  };
}

// deno-lint-ignore no-explicit-any
type Context = any;

/** `@keeb/predb` — search, pre lookup, NFO, stats, and season coverage. */
export const model = {
  type: "@keeb/predb",
  version: "2026.10.09.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    releases: {
      description: "Releases returned by a PreDB search, parsed into tags",
      schema: SearchSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    release: {
      description: "Exact PreDB lookup for a single release name",
      schema: ReleaseLookupSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    nfo: {
      description: "NFO URL, image URL, and text content for a release",
      schema: NfoSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    stats: {
      description: "PreDB database, group, section, or nuke statistics",
      schema: StatsSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    coverage: {
      description:
        "Per-group episode coverage for one show season — which release variants are complete",
      schema: CoverageSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    search: {
      description:
        "Search PreDB (prefix match on release name, plus group/section/genre/tag/status filters). With no filters it returns the latest pres, like the RSS feed.",
      arguments: z.object({
        q: z.string().optional().describe(
          "Release name prefix, e.g. Criminal.Minds.S19",
        ),
        group: z.string().optional().describe(
          "Group(s), comma-separated; prefix with - to exclude",
        ),
        section: z.string().optional().describe(
          "Section(s), e.g. TV-WEB-HD-X264; comma-separated, - to exclude",
        ),
        genre: z.string().optional().describe("Genre(s), comma-separated"),
        tag: z.string().optional().describe(
          "Tag(s) in the release name, e.g. 2160p,-foreign",
        ),
        status: z.string().optional().describe("nuked, unnuked, or -nuked"),
        orderBy: z.enum(["pretime", "release"]).default("pretime"),
        sort: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().min(1).max(100).default(100).describe(
          "Results per page (1-100)",
        ),
        maxPages: z.number().min(1).max(1000).default(1).describe(
          "Pages to fetch (2.1s apart to respect the 30/60s rate limit)",
        ),
        name: z.string().optional().describe(
          "Instance name for the stored result (default: derived from filters)",
        ),
      }),
      execute: async (
        // deno-lint-ignore no-explicit-any
        args: any,
        context: Context,
      ) => {
        const params: Record<string, string> = {
          order_by: args.orderBy,
          sort: args.sort.toUpperCase(),
          limit: String(Math.floor(args.limit)),
        };
        for (const k of ["q", "group", "section", "genre", "tag", "status"]) {
          if (args[k]) params[k] = args[k];
        }
        const { releases, pages } = await searchAll(
          context.globalArgs.baseUrl,
          params,
          args.maxPages,
          context.logger,
        );
        const filters = ["q", "group", "section", "genre", "tag", "status"]
          .filter((k) => args[k]).map((k) => `${k}-${args[k]}`).join("-");
        const name = args.name ?? `search-${slugify(filters) || "latest"}`;
        const handle = await context.writeResource("releases", name, {
          params,
          fetchedAt: new Date().toISOString(),
          pages,
          count: releases.length,
          releases,
        });
        return { dataHandles: [handle] };
      },
    },
    pre: {
      description:
        "Look up one exact release name (pretime, size, nuke status)",
      arguments: z.object({
        release: z.string().describe("Exact release name"),
      }),
      // deno-lint-ignore no-explicit-any
      execute: async (args: any, context: Context) => {
        const json = await apiGet(
          context.globalArgs.baseUrl,
          { type: "pre", release: args.release },
          context.logger,
        );
        const data = Array.isArray(json.data) ? json.data : [];
        const handle = await context.writeResource(
          "release",
          `release-${args.release}`,
          {
            release: args.release,
            found: data.length > 0,
            fetchedAt: new Date().toISOString(),
            pre: data.length > 0 ? mapRelease(data[0]) : null,
          },
        );
        return { dataHandles: [handle] };
      },
    },
    nfo: {
      description: "Fetch the NFO for an exact release name",
      arguments: z.object({
        release: z.string().describe("Exact release name"),
        fetchContent: z.boolean().default(true).describe(
          "Also download the NFO text",
        ),
      }),
      // deno-lint-ignore no-explicit-any
      execute: async (args: any, context: Context) => {
        const json = await apiGet(
          context.globalArgs.baseUrl,
          { type: "nfo", release: args.release },
          context.logger,
        );
        const nfoUrl: string | null = json.data?.nfo || null;
        const nfoImageUrl: string | null = json.data?.nfo_img || null;
        let content: string | null = null;
        if (nfoUrl && args.fetchContent) {
          const res = await fetch(nfoUrl);
          if (res.ok) {
            // NFOs are CP437; latin1 keeps the bytes readable without mangling ASCII
            content = new TextDecoder("latin1").decode(
              new Uint8Array(await res.arrayBuffer()),
            );
          } else {
            await res.body?.cancel();
            context.logger.warning("NFO download failed: {status}", {
              status: res.status,
            });
          }
        }
        const handle = await context.writeResource(
          "nfo",
          `nfo-${args.release}`,
          {
            release: args.release,
            found: nfoUrl !== null,
            fetchedAt: new Date().toISOString(),
            nfoUrl,
            nfoImageUrl,
            content,
          },
        );
        return { dataHandles: [handle] };
      },
    },
    stats: {
      description:
        "Fetch PreDB statistics: general, nuked, unnuked, group (needs target), or section (needs target)",
      arguments: z.object({
        kind: z.enum(["general", "nuked", "unnuked", "group", "section"])
          .default("general"),
        target: z.string().optional().describe(
          "Group or section name for kind=group/section",
        ),
      }),
      // deno-lint-ignore no-explicit-any
      execute: async (args: any, context: Context) => {
        const params: Record<string, string> = {
          type: {
            general: "stats",
            nuked: "nukedstats",
            unnuked: "unnukedstats",
            group: "groupstats",
            section: "sectionstats",
          }[args.kind as string]!,
        };
        if (args.kind === "group" || args.kind === "section") {
          if (!args.target) {
            throw new Error(`kind=${args.kind} requires target`);
          }
          params[args.kind] = args.target;
        }
        const json = await apiGet(
          context.globalArgs.baseUrl,
          params,
          context.logger,
        );
        // first_pre / last_pre arrays hold raw releases; map them like search
        const data: Record<string, unknown> = { ...(json.data ?? {}) };
        for (const k of ["first_pre", "last_pre"]) {
          if (Array.isArray(data[k])) {
            data[k] = (data[k] as unknown[]).map(mapRelease);
          }
        }
        const name = args.target
          ? `stats-${args.kind}-${slugify(args.target)}`
          : `stats-${args.kind}`;
        const handle = await context.writeResource("stats", name, {
          kind: args.kind,
          target: args.target ?? null,
          fetchedAt: new Date().toISOString(),
          data,
        });
        return { dataHandles: [handle] };
      },
    },
    season_coverage: {
      description:
        "Fetch every release for a show season and report which groups/variants have a complete set of episodes (nukes excluded)",
      arguments: z.object({
        show: z.string().describe(
          "Show name as it appears in scene release names, e.g. 'Criminal Minds'",
        ),
        season: z.number().min(0).describe("Season number"),
        episodeCount: z.number().min(1).optional().describe(
          "Episodes in the season; default is the FiNAL-tagged episode, else the highest seen",
        ),
        maxPages: z.number().min(1).max(1000).default(20).describe(
          "Page cap at 100 releases per page",
        ),
      }),
      // deno-lint-ignore no-explicit-any
      execute: async (args: any, context: Context) => {
        args.season = Math.floor(args.season);
        if (args.episodeCount) {
          args.episodeCount = Math.floor(args.episodeCount);
        }
        const query = `${args.show.trim().replace(/[\s.]+/g, ".")}.S${
          String(args.season).padStart(2, "0")
        }`;
        const { releases, pages } = await searchAll(
          context.globalArgs.baseUrl,
          { q: query, order_by: "release", sort: "ASC", limit: "100" },
          args.maxPages,
          context.logger,
        );
        const coverage = buildCoverage(
          releases,
          args.show,
          args.season,
          args.episodeCount,
        );
        context.logger.info(
          "{query}: {count} releases, {variants} variants, {complete} complete over {eps} episodes ({source})",
          {
            query,
            count: releases.length,
            variants: coverage.variants.length,
            complete: coverage.complete.length,
            eps: coverage.episodeCount,
            source: coverage.episodeCountSource,
          },
        );
        const handle = await context.writeResource(
          "coverage",
          `coverage-${slugify(args.show)}-s${
            String(args.season).padStart(2, "0")
          }`,
          {
            show: args.show,
            season: args.season,
            query,
            fetchedAt: new Date().toISOString(),
            pages,
            releaseCount: releases.length,
            ...coverage,
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
