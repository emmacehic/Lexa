import { describe, expect, it } from "vitest";

import { sniffContainer, sniffLooksLikeHtml, unrecognizedMediaMessage } from "@/lib/mime";

describe("sniffLooksLikeHtml", () => {
  it("detects a saved error or login page", () => {
    const html = Buffer.from("<!DOCTYPE html>\n<!--[if IE]><html><![endif]-->");
    expect(sniffLooksLikeHtml(html)).toBe(true);
    expect(sniffContainer(html)).toBeNull();
    expect(unrecognizedMediaMessage(html)).toMatch(/web page/i);
  });
});

describe("sniffContainer", () => {
  it("recognises an ID3 mp3", () => {
    const buf = Buffer.alloc(16, 0);
    buf.write("ID3", 0);
    expect(sniffContainer(buf)?.container).toBe("mp3");
  });
});
