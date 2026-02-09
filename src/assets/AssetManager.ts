import { Terrain, Direction, TILE_W, TILE_H, TILE_HALF_W, TILE_HALF_H } from "../types";

/**
 * Asset manager with two-tier loading:
 *
 * 1. **AI-generated art** — PNGs in public/assets/ produced by the Gemini
 *    pipeline (scripts/asset-gen/) and deployed via deploy-assets.py.
 * 2. **Procedural fallbacks** — Canvas 2D-drawn placeholders generated at
 *    startup for any asset that doesn't have a PNG on disk.
 *
 * The game always works. If you've generated art, it loads it. If not,
 * procedural placeholders are used automatically.
 */

type DrawTarget = HTMLCanvasElement | HTMLImageElement;

interface AssetManifest {
  tiles?: Record<string, string>;
  sprites?: Record<string, Record<string, string>>;
  objects?: Record<string, string>;
  items?: Record<string, string>;
  portraits?: Record<string, string>;
}

export class AssetManager {
  private tiles = new Map<Terrain, DrawTarget>();
  private sprites = new Map<string, Map<Direction, DrawTarget>>();
  private objects = new Map<string, DrawTarget>();
  private items = new Map<string, DrawTarget>();
  private portraits = new Map<string, HTMLImageElement>();

  private loadedCount = 0;
  private totalToLoad = 0;

  /**
   * Initialize: generate procedural fallbacks, then try to load AI art on top.
   * Call this instead of generateAll().
   */
  async init() {
    // Step 1: Generate procedural placeholders for everything
    this.generateAllProcedural();

    // Step 2: Attempt to load manifest and override with real PNGs
    try {
      const resp = await fetch("/assets/manifest.json");
      if (resp.ok) {
        const manifest: AssetManifest = await resp.json();
        await this.loadFromManifest(manifest);
        console.log(
          `[AssetManager] Loaded ${this.loadedCount}/${this.totalToLoad} AI-generated assets`,
        );
      } else {
        console.log("[AssetManager] No manifest found — using procedural art");
      }
    } catch {
      console.log("[AssetManager] Could not load manifest — using procedural art");
    }
  }

  /** Legacy sync init — procedural only, no manifest loading */
  generateAll() {
    this.generateAllProcedural();
  }

  getTile(terrain: Terrain): DrawTarget | undefined {
    return this.tiles.get(terrain);
  }

  getSprite(key: string, dir: Direction): DrawTarget | undefined {
    return this.sprites.get(key)?.get(dir);
  }

  getObject(key: string): DrawTarget | undefined {
    return this.objects.get(key);
  }

  getItem(key: string): DrawTarget | undefined {
    return this.items.get(key);
  }

  getPortrait(key: string): HTMLImageElement | undefined {
    return this.portraits.get(key);
  }

  // -----------------------------------------------------------------------
  // PNG loading from manifest
  // -----------------------------------------------------------------------

  private async loadFromManifest(manifest: AssetManifest) {
    const promises: Promise<void>[] = [];

    // Tiles — keys are Terrain enum names: "Sand", "Dirt", etc.
    if (manifest.tiles) {
      for (const [terrainName, path] of Object.entries(manifest.tiles)) {
        const terrain = Terrain[terrainName as keyof typeof Terrain];
        if (terrain !== undefined) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) { this.tiles.set(terrain, img); this.loadedCount++; }
            }),
          );
        }
      }
    }

    // Sprites — keys are sprite keys, values are {direction: path}
    if (manifest.sprites) {
      for (const [spriteKey, directions] of Object.entries(manifest.sprites)) {
        if (!this.sprites.has(spriteKey)) {
          this.sprites.set(spriteKey, new Map());
        }
        for (const [dir, path] of Object.entries(directions)) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) {
                this.sprites.get(spriteKey)!.set(dir as Direction, img);
                this.loadedCount++;
              }
            }),
          );
        }
      }
    }

    // Objects
    if (manifest.objects) {
      for (const [key, path] of Object.entries(manifest.objects)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) { this.objects.set(key, img); this.loadedCount++; }
          }),
        );
      }
    }

    // Items — keys are icon keys: "item_pistol", etc.
    if (manifest.items) {
      for (const [key, path] of Object.entries(manifest.items)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) { this.items.set(key, img); this.loadedCount++; }
          }),
        );
      }
    }

    // Portraits
    if (manifest.portraits) {
      for (const [key, path] of Object.entries(manifest.portraits)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) { this.portraits.set(key, img); this.loadedCount++; }
          }),
        );
      }
    }

    await Promise.all(promises);
  }

  private loadImage(path: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`[AssetManager] Failed to load: ${path}`);
        resolve(null);
      };
      img.src = path;
    });
  }

  // -----------------------------------------------------------------------
  // Procedural fallback generation
  // -----------------------------------------------------------------------

  private generateAllProcedural() {
    this.generateTiles();
    this.generateSprites();
    this.generateObjects();
    this.generateItems();
  }

  private generateTiles() {
    const terrainColors: Record<Terrain, { base: string; detail: string; noise: string }> = {
      [Terrain.Sand]:        { base: "#b8a67c", detail: "#d4c4a0", noise: "#a0926a" },
      [Terrain.Dirt]:        { base: "#8b7355", detail: "#9e8668", noise: "#6b5340" },
      [Terrain.CrackedEarth]:{ base: "#9e8e6e", detail: "#6b5b40", noise: "#b8a87e" },
      [Terrain.Rubble]:      { base: "#7a7a6a", detail: "#9e9e8e", noise: "#5a5a4a" },
      [Terrain.Road]:        { base: "#6e6e5e", detail: "#5a5a4a", noise: "#8e8e7e" },
      [Terrain.Concrete]:    { base: "#8e8e7e", detail: "#a0a090", noise: "#6e6e5e" },
      [Terrain.Grass]:       { base: "#6b7b4a", detail: "#7a8b5a", noise: "#4a5b3a" },
      [Terrain.Water]:       { base: "#3a5a5a", detail: "#4a7070", noise: "#2a4a4a" },
    };
    for (const [terrainStr, colors] of Object.entries(terrainColors)) {
      const terrain = Number(terrainStr) as Terrain;
      const canvas = this.createCanvas(TILE_W, TILE_H);
      const ctx = canvas.getContext("2d")!;
      this.drawIsoDiamond(ctx, colors.base);
      this.addTileNoise(ctx, colors.detail, colors.noise, terrain);
      this.tiles.set(terrain, canvas);
    }
  }

  private drawIsoDiamond(ctx: CanvasRenderingContext2D, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(0, TILE_HALF_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.beginPath();
    ctx.moveTo(0, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();
  }

  private addTileNoise(ctx: CanvasRenderingContext2D, detail: string, noise: string, terrain: Terrain) {
    const rng = this.seededRng(terrain * 1000);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 1); ctx.lineTo(TILE_W - 1, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H - 1); ctx.lineTo(1, TILE_HALF_H);
    ctx.closePath();
    ctx.clip();
    const dotCount = terrain === Terrain.Water ? 8 : 25;
    for (let i = 0; i < dotCount; i++) {
      ctx.fillStyle = rng() > 0.5 ? detail : noise;
      ctx.globalAlpha = 0.3 + rng() * 0.4;
      ctx.fillRect(rng() * TILE_W, rng() * TILE_H, 1 + rng() * 2, 1 + rng() * 2);
    }
    if (terrain === Terrain.CrackedEarth) {
      ctx.strokeStyle = noise; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.6;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(10+rng()*44,5+rng()*22); ctx.lineTo(10+rng()*44,5+rng()*22); ctx.stroke(); }
    }
    if (terrain === Terrain.Road) {
      ctx.strokeStyle = "#b8a67c"; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
      ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(TILE_HALF_W-10,TILE_HALF_H); ctx.lineTo(TILE_HALF_W+10,TILE_HALF_H); ctx.stroke(); ctx.setLineDash([]);
    }
    if (terrain === Terrain.Water) {
      ctx.strokeStyle = "#5a8a8a"; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.5;
      for (let i = 0; i < 3; i++) { const y=8+i*8; ctx.beginPath(); ctx.moveTo(15+rng()*10,y); ctx.quadraticCurveTo(32,y+2*(rng()-0.5),49-rng()*10,y); ctx.stroke(); }
    }
    if (terrain === Terrain.Grass) {
      ctx.strokeStyle = "#7a8b5a"; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
      for (let i = 0; i < 8; i++) { const gx=10+rng()*44; const gy=5+rng()*22; ctx.beginPath(); ctx.moveTo(gx,gy); ctx.lineTo(gx+(rng()-0.5)*3,gy-3-rng()*3); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private generateSprites() {
    const configs: Record<string, { body: string; head: string; accent: string }> = {
      player:       { body: "#6b5340", head: "#d4c4a0", accent: "#40c040" },
      npc_sheriff:  { body: "#5a4a3a", head: "#d4c4a0", accent: "#c4703a" },
      npc_merchant: { body: "#7a6b5a", head: "#d4c4a0", accent: "#8ec44a" },
      npc_doc:      { body: "#8e8e7e", head: "#d4c4a0", accent: "#4a8ab0" },
      npc_raider:   { body: "#4a3a2a", head: "#c4a080", accent: "#b83030" },
    };
    const dirs: Direction[] = ["N","NE","E","SE","S","SW","W","NW"];
    for (const [key, colors] of Object.entries(configs)) {
      const m = new Map<Direction, HTMLCanvasElement>();
      for (const d of dirs) m.set(d, this.genChar(colors, d, key === "player"));
      this.sprites.set(key, m);
    }
  }

  private genChar(c: {body:string;head:string;accent:string}, dir: Direction, isPlayer: boolean): HTMLCanvasElement {
    const w=24, h=36, canvas=this.createCanvas(w,h), ctx=canvas.getContext("2d")!, cx=w/2;
    ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(cx,h-3,8,3,0,0,Math.PI*2); ctx.fill();
    const bs=this.dirOff(dir);
    ctx.fillStyle=c.body; ctx.fillRect(cx-5+bs*1.5,14,10,14);
    ctx.fillStyle=c.accent; ctx.fillRect(cx-5+bs*1.5,20,10,2);
    ctx.fillStyle=this.darken(c.body,0.7); const ls=Math.abs(bs)>0?2:0;
    ctx.fillRect(cx-3+bs-ls,28,3,5); ctx.fillRect(cx+bs+ls,28,3,5);
    ctx.fillStyle="#3a3a2e"; ctx.fillRect(cx-3+bs-ls,32,3,2); ctx.fillRect(cx+bs+ls,32,3,2);
    ctx.fillStyle=c.head; ctx.beginPath(); ctx.arc(cx+bs,10,5,0,Math.PI*2); ctx.fill();
    if(dir!=="N"&&dir!=="NW"&&dir!=="NE"){ctx.fillStyle="#1e1e16";const eo=bs*0.5;ctx.fillRect(cx-2+eo,9,1,1);ctx.fillRect(cx+1+eo,9,1,1);}
    if(isPlayer){ctx.strokeStyle="rgba(64,192,64,0.5)";ctx.lineWidth=0.5;ctx.beginPath();ctx.arc(cx+bs,10,6,0,Math.PI*2);ctx.stroke();}
    if(c.accent==="#b83030"){ctx.strokeStyle="#9e9e8e";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx+5+bs,16);ctx.lineTo(cx+10+bs,12);ctx.stroke();}
    return canvas;
  }

  private dirOff(d: Direction): number { return d==="E"||d==="NE"||d==="SE"?2:d==="W"||d==="NW"||d==="SW"?-2:0; }

  private generateObjects() {
    const wall=this.createCanvas(TILE_W,32), wc=wall.getContext("2d")!;
    wc.fillStyle="#7a6a5a"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_W,24); wc.lineTo(TILE_HALF_W,32); wc.lineTo(0,24); wc.lineTo(0,8); wc.closePath(); wc.fill();
    wc.fillStyle="#8e7e6e"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_HALF_W,16); wc.lineTo(0,8); wc.closePath(); wc.fill();
    this.objects.set("wall",wall);
    const barrel=this.createCanvas(16,20), bc=barrel.getContext("2d")!;
    bc.fillStyle="#7a3b1e"; bc.fillRect(2,4,12,14); bc.fillStyle="#a0522d"; bc.beginPath(); bc.ellipse(8,4,6,3,0,0,Math.PI*2); bc.fill();
    bc.fillStyle="#c4703a"; bc.fillRect(2,8,12,2); bc.fillRect(2,14,12,2);
    this.objects.set("barrel",barrel);
    const rock=this.createCanvas(18,14), rc=rock.getContext("2d")!;
    rc.fillStyle="#6e6e5e"; rc.beginPath(); rc.moveTo(3,12); rc.lineTo(1,8); rc.lineTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(17,10); rc.lineTo(13,13); rc.closePath(); rc.fill();
    rc.fillStyle="#8e8e7e"; rc.beginPath(); rc.moveTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(10,6); rc.closePath(); rc.fill();
    this.objects.set("rock",rock);
  }

  private generateItems() {
    this.genItem("item_pistol", (c) => { c.fillStyle="#6e6e5e"; c.fillRect(4,6,12,4); c.fillRect(8,6,4,10); c.fillStyle="#5a5a4a"; c.fillRect(4,6,3,3); });
    this.genItem("item_rifle", (c) => { c.fillStyle="#6e6e5e"; c.fillRect(2,8,16,3); c.fillRect(10,8,4,8); c.fillStyle="#8b7355"; c.fillRect(2,8,6,3); });
    this.genItem("item_knife", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(8,2,2,10); c.fillStyle="#6b5340"; c.fillRect(7,12,4,4); });
    this.genItem("item_bat", (c) => { c.fillStyle="#8b7355"; c.fillRect(9,2,3,14); c.fillStyle="#6b5340"; c.fillRect(8,2,5,4); });
    this.genItem("item_armor", (c) => { c.fillStyle="#6b5340"; c.fillRect(5,4,10,12); c.fillStyle="#8b7355"; c.fillRect(6,5,8,4); });
    this.genItem("item_stimpak", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(8,3,4,12); c.fillStyle="#b83030"; c.fillRect(9,5,2,4); c.fillStyle="#d4c4a0"; c.fillRect(7,3,6,2); });
    this.genItem("item_radaway", (c) => { c.fillStyle="#c4703a"; c.fillRect(6,4,8,10); c.fillStyle="#d4c4a0"; c.fillRect(7,5,6,8); });
    this.genItem("item_nuka", (c) => { c.fillStyle="#b83030"; c.fillRect(7,3,6,12); c.fillStyle="#d4c4a0"; c.fillRect(8,8,4,1); c.fillStyle="#9e9e8e"; c.fillRect(9,2,2,2); });
    this.genItem("item_food", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(5,5,10,10); c.fillStyle="#b8a67c"; c.fillRect(6,6,8,3); });
    this.genItem("item_caps", (c) => { c.fillStyle="#c4703a"; for(let i=0;i<3;i++){c.beginPath();c.arc(8+i*2,10-i*2,4,0,Math.PI*2);c.fill();c.fillStyle="#a0522d";} });
    this.genItem("item_pin", (c) => { c.strokeStyle="#9e9e8e"; c.lineWidth=1.5; c.beginPath(); c.moveTo(10,4); c.lineTo(10,14); c.lineTo(7,12); c.stroke(); });
    this.genItem("item_holotape", (c) => { c.fillStyle="#5a5a4a"; c.fillRect(4,5,12,10); c.fillStyle="#8ec44a"; c.fillRect(6,7,8,2); });
  }

  private genItem(key: string, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = this.createCanvas(20, 20);
    draw(canvas.getContext("2d")!);
    this.items.set(key, canvas);
  }

  private createCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  private darken(hex: string, f: number): string {
    return `rgb(${Math.floor(parseInt(hex.slice(1,3),16)*f)},${Math.floor(parseInt(hex.slice(3,5),16)*f)},${Math.floor(parseInt(hex.slice(5,7),16)*f)})`;
  }
  private seededRng(seed: number) {
    return () => { seed|=0; seed=(seed+0x6d2b79f5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return((t^(t>>>14))>>>0)/4294967296; };
  }
}
