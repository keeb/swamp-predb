import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCoverage,
  mapRelease,
  parseRelease,
} from "../extensions/models/predb.ts";

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
