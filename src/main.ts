import { Game } from "./engine/Game";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas element #game not found");

  const game = new Game(canvas);
  await game.init();

  // Hide loading screen
  const loading = document.getElementById("loading");
  if (loading) loading.classList.add("hidden");

  game.start();
}

boot().catch((err) => {
  console.error("Failed to start Isogame:", err);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.textContent = `ERROR: ${err.message}`;
    loading.style.color = "#b83030";
  }
});
