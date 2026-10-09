/**
 * Unit tests for the PreDB model: release parsing, coverage grouping, and
 * method execution against a mocked fetch.
 *
 * @module
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildCoverage,
  mapRelease,
  model,
  parseRelease,
  retryWaitMs,
} from "./predb.ts";

type Write = { spec: string; name: string; data: Record<string, unknown> };

/** Run a method with fetch replaced by `handler`; returns captured writes. */
async function runMethod(
  method: keyof typeof model.methods,
  args: Record<string, unknown>,
  handler: (url: URL) => Response,
): Promise<{ writes: Write[]; urls: URL[] }> {
  const writes: Write[] = [];
  const urls: URL[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    urls.push(url);
    return Promise.resolve(handler(url));
  };
  const noop = () => {};
  const context = {
    globalArgs: { baseUrl: "https://api.example.com/" },
    logger: { debug: noop, info: noop, warning: noop, error: noop },
    writeResource: (
      spec: string,
      name: string,
      data: Record<string, unknown>,
    ) => {
      writes.push({ spec, name, data });
      return Promise.resolve({ name });
    },
  };
  try {
    const m = model.methods[method];
    // deno-lint-ignore no-explicit-any
    await m.execute(m.arguments.parse(args) as any, context);
  } finally {
    globalThis.fetch = realFetch;
  }
  return { writes, urls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function raw(release: string, status = 0) {
  return {
    id: 1,
    pretime: 1700000000,
    release,
    section: "TV-WEB-HD-X264",
    files: 20,
    size: 1000,
    status,
    reason: "",
    group: release.slice(release.lastIndexOf("-") + 1),
    genre: "",
    url: `/rls/${release}`,
  };
}

Deno.test("parseRelease: english web episode", () => {
  const p = parseRelease("Criminal.Minds.S19E09.1080p.WEB.h264-ETHEL");
  assertEquals(p.show, "Criminal Minds");
  assertEquals(p.season, 19);
  assertEquals(p.episodes, [9]);
  assertEquals(p.resolution, "1080p");
  assertEquals(p.source, "WEB");
  assertEquals(p.codec, "H264");
  assertEquals(p.foreign, false);
});

Deno.test("parseRelease: foreign, hdr, final, episode title", () => {
  const p = parseRelease(
    "Criminal.Minds.S19E10.FiNAL.MULTi.DV.HDR.2160p.WEB.H265-UKDTV",
  );
  assertEquals(p.episodes, [10]);
  assertEquals(p.flags, ["FINAL"]);
  assertEquals(p.languages, ["MULTI"]);
  assertEquals(p.hdr, ["DV", "HDR"]);
  assertEquals(p.foreign, true);

  const t = parseRelease(
    "Criminal.Minds.S19E09.Special.Agent.Garrity.CZECH.DUAL.1080p.WEB.H264-SDTV",
  );
  assertEquals(t.languages, ["CZECH", "DUAL"]);
  assertEquals(t.resolution, "1080p");
});

Deno.test("parseRelease: season pack and multi-episode", () => {
  const pack = parseRelease("Some.Show.S02.1080p.WEB.h264-GRP");
  assertEquals(pack.seasonPack, true);
  assertEquals(pack.episodes, []);
  assertEquals(
    parseRelease("Some.Show.S02E01-E03.720p.HDTV.x264-GRP").episodes,
    [1, 2, 3],
  );
  assertEquals(
    parseRelease("Some.Show.S02E01E02.720p.HDTV.x264-GRP").episodes,
    [1, 2],
  );
});

Deno.test("parseRelease: non-episodic release", () => {
  const p = parseRelease("Toy.Soldiers.HD-DOGE");
  assertEquals(p.show, null);
  assertEquals(p.season, null);
});

function rel(release: string, status = 0, reason = "") {
  return mapRelease({
    release,
    group: release.slice(release.lastIndexOf("-") + 1),
    pretime: 1700000000,
    status,
    reason,
    url: `/rls/${release}`,
  });
}

Deno.test("buildCoverage: complete vs gapped vs nuked", () => {
  const releases = [
    ...[1, 2, 3].map((e) => rel(`Show.S01E0${e}.1080p.WEB.h264-AAA`)),
    rel("Show.S01E01.720p.WEB.h264-BBB"),
    rel("Show.S01E03.720p.WEB.h264-BBB"),
    rel("Show.S01E01.1080p.WEB.h264-CCC"),
    rel("Show.S01E02.1080p.WEB.h264-CCC", 1, "bad.ivtc"),
    rel("Show.S01E03.FiNAL.1080p.WEB.h264-CCC"),
    rel("Show.S01.2160p.WEB.h265-DDD"),
    rel("Other.Show.S01E04.1080p.WEB.h264-AAA"),
  ];
  const c = buildCoverage(releases, "Show", 1);
  assertEquals(c.episodeCount, 3);
  assertEquals(c.episodeCountSource, "final-tag");
  assertEquals(c.complete.sort(), [
    "AAA 1080p WEB H264",
    "DDD 2160p WEB H265",
  ]);
  const bbb = c.variants.find((v) => v.group === "BBB")!;
  assertEquals(bbb.missing, [2]);
  const ccc = c.variants.find((v) => v.group === "CCC")!;
  assertEquals(ccc.complete, false);
  assertEquals(ccc.missing, [2]);
  assertEquals(ccc.nuked[0].reason, "bad.ivtc");
});

Deno.test("buildCoverage: explicit episode count overrides", () => {
  const releases = [1, 2].map((e) => rel(`Show.S01E0${e}.1080p.WEB.h264-AAA`));
  const c = buildCoverage(releases, "Show", 1, 10);
  assertEquals(c.episodeCountSource, "argument");
  assertEquals(c.complete, []);
  assertEquals(c.variants[0].missing, [3, 4, 5, 6, 7, 8, 9, 10]);
});

Deno.test("retryWaitMs: Retry-After wins, else 60s for 429, backoff otherwise", () => {
  assertEquals(retryWaitMs(429, "7", 1), 7000);
  assertEquals(retryWaitMs(429, null, 1), 60_000);
  assertEquals(retryWaitMs(503, null, 2), 10_000);
  assertEquals(retryWaitMs(null, null, 3), 15_000);
  assertEquals(retryWaitMs(429, "Wed, 21 Oct 2026 07:28:00 GMT", 1), 60_000);
});

Deno.test("season_coverage: writes coverage with query and truncated=false", async () => {
  const { writes, urls } = await runMethod(
    "season_coverage",
    { show: "Criminal Minds", season: 19 },
    () =>
      json({
        status: "success",
        data: [
          raw("Criminal.Minds.S19E01.1080p.WEB.h264-GRACE"),
          raw("Criminal.Minds.S19E02.FiNAL.1080p.WEB.h264-GRACE"),
          raw("Criminal.Minds.S19E01.720p.WEB.h264-DiRT"),
        ],
      }),
  );
  assertEquals(urls.length, 1);
  assertEquals(urls[0].searchParams.get("q"), "Criminal.Minds.S19");
  assertEquals(writes.length, 1);
  assertEquals(writes[0].spec, "coverage");
  assertEquals(writes[0].name, "coverage-criminal-minds-s19");
  assertEquals(writes[0].data.truncated, false);
  assertEquals(writes[0].data.episodeCount, 2);
  assertEquals(writes[0].data.complete, ["GRACE 1080p WEB H264"]);
});

Deno.test("season_coverage: full last page at maxPages sets truncated", async () => {
  const page = Array.from(
    { length: 100 },
    (_, i) => raw(`Show.S01E${String(i + 1).padStart(3, "0")}.WEB.h264-GRP`),
  );
  const { writes } = await runMethod(
    "season_coverage",
    { show: "Show", season: 1, maxPages: 1 },
    () => json({ status: "success", data: page }),
  );
  assertEquals(writes[0].data.truncated, true);
});

Deno.test("search: API error throws with the API message and writes nothing", async () => {
  let writes: Write[] = [];
  await assertRejects(
    async () => {
      ({ writes } = await runMethod(
        "search",
        { q: "x" },
        () => json({ status: "error", message: "Invalid search type" }, 400),
      ));
    },
    Error,
    "Invalid search type",
  );
  assertEquals(writes, []);
});

Deno.test("search: custom name stays in the search- namespace", async () => {
  const { writes } = await runMethod(
    "search",
    { group: "ETHEL", name: "coverage-foo" },
    () => json({ status: "success", data: [] }),
  );
  assertEquals(writes[0].name, "search-coverage-foo");
  assertEquals(writes[0].data.count, 0);
});

Deno.test("pre: missing release records found=false", async () => {
  const { writes } = await runMethod(
    "pre",
    { release: "No.Such.Release-NOPE" },
    () => json({ status: "success", results: 0, message: "No results found." }),
  );
  assertEquals(writes[0].name, "release-No.Such.Release-NOPE");
  assertEquals(writes[0].data.found, false);
  assertEquals(writes[0].data.pre, null);
});

Deno.test("stats: group kind without target throws before any request", async () => {
  let urls: URL[] = [];
  await assertRejects(
    async () => {
      ({ urls } = await runMethod(
        "stats",
        { kind: "group" },
        () => json({ status: "success", data: {} }),
      ));
    },
    Error,
    "requires target",
  );
  assertEquals(urls, []);
});
