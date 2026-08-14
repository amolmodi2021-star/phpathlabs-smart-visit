import { describe, it, expect } from "vitest";
import { renderCode128Png, replaceCanvasesWithPngImages } from "@/lib/code128Png";

describe("renderCode128Png", () => {
  it("returns null when there is no invoice number", () => {
    expect(renderCode128Png("")).toBeNull();
    expect(renderCode128Png(null)).toBeNull();
    expect(renderCode128Png("   ")).toBeNull();
  });
});

describe("replaceCanvasesWithPngImages", () => {
  it("swaps canvas nodes for PNG images so html-to-image can capture them", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 8;
    canvas.setAttribute("style", "height:28px");
    canvas.toDataURL = () => "data:image/png;base64,AAA";
    root.appendChild(canvas);

    replaceCanvasesWithPngImages(root);

    expect(root.querySelector("canvas")).toBeNull();
    const img = root.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(img?.style.height).toBe("28px");
  });

  it("removes empty canvases instead of emitting a blank image", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 0;
    canvas.height = 0;
    root.appendChild(canvas);

    replaceCanvasesWithPngImages(root);

    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
  });
});
