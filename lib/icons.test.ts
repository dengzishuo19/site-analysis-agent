import test from "node:test";
import assert from "node:assert/strict";
import { ICON_PATHS, iconSvg } from "./icons.ts";
import { CATEGORIES } from "./palette.ts";

test("每个类别都有简笔画图标，且图标各不相同", () => {
  for (const key of Object.keys(CATEGORIES)) assert.ok(ICON_PATHS[key], key);
  assert.equal(new Set(Object.values(ICON_PATHS)).size, Object.keys(ICON_PATHS).length);
});

test("图标是描边线条、跟随文字颜色、对读屏隐藏；未知类别返回空", () => {
  const svg = iconSvg("park", 20);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /width="20"/);
  assert.equal(iconSvg("mystery"), "");
});
