export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 8_000);
}

const SCENE_KEY = "meridian-mockup-scene";

export function loadMockupScene(): "pool" | "riad" {
  try {
    return localStorage.getItem(SCENE_KEY) === "riad" ? "riad" : "pool";
  } catch {
    return "pool";
  }
}

export function saveMockupScene(scene: "pool" | "riad") {
  try {
    localStorage.setItem(SCENE_KEY, scene);
  } catch {
    /* ignore */
  }
}
