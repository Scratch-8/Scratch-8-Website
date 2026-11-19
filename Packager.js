const PICO_PALETTE = [
  "#000000", "#1D2B53", "#7E2553", "#008751",
  "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436",
  "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA"
];

const logEl = document.getElementById("log");
function log(msg) {
  logEl.textContent += "\n" + msg;
}

document.getElementById("p8File").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("p8Text").value = reader.result;
    logEl.textContent = `Loaded ${file.name} (${reader.result.length} bytes).`;
  };
  reader.readAsText(file);
});

// Minimal MD5 implementation for Scratch asset filenames
function md5(str) {
  function rotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000;
    const lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    }
    return lResult ^ lX8 ^ lY8;
  }
  const F = (x, y, z) => (x & y) | (~x & z);
  const G = (x, y, z) => (x & z) | (y & ~z);
  const H = (x, y, z) => x ^ y ^ z;
  const I = (x, y, z) => y ^ (x | ~z);
  function FF(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function GG(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function HH(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function II(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }

  const utf8 = unescape(encodeURIComponent(str));
  const words = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xFF) << ((i % 4) * 8);
  }
  words[utf8.length >> 2] |= 0x80 << ((utf8.length % 4) * 8);
  words[(((utf8.length + 8) >> 6) + 1) * 16 - 2] = utf8.length * 8;

  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S = [[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];
  const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

  for (let k = 0; k < words.length; k += 16) {
    const [AA, BB, CC, DD] = [a, b, c, d];
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = FF; g = i; }
      else if (i < 32) { f = GG; g = (5 * i + 1) % 16; }
      else if (i < 48) { f = HH; g = (3 * i + 5) % 16; }
      else { f = II; g = (7 * i) % 16; }
      const temp = d;
      d = c;
      c = b;
      b = f(a, b, c, temp, words[k + g] || 0, S[i >> 4][i % 4], K[i]);
      a = temp;
    }
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  return [a, b, c, d].map(n => [0,1,2,3].map(i => ((n >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

// 1. Parse .p8 cartridge into sections
function parseCartridge(raw) {
  const sections = { lua: [], gfx: [], gff: [], map: [] };
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const tag = line.trim();
    if (tag === "__lua__") { current = "lua"; continue; }
    if (tag === "__gfx__") { current = "gfx"; continue; }
    if (tag === "__gff__") { current = "gff"; continue; }
    if (tag === "__map__") { current = "map"; continue; }
    if (tag.startsWith("__") && tag.endsWith("__")) { current = null; continue; }
    if (current) sections[current].push(line);
  }
  return {
    lua: sections.lua.join("\n"),
    gfx: sections.gfx,
    gff: sections.gff.join(""),
    map: sections.map
  };
}

// 2. Preprocess PICO-8 shorthand Lua into standard Lua 5.2 for luaparse
function preprocessPicoLua(code) {
  // Expand compound operators (+=, -=, *=, /=, %=)
  code = code.replace(/([a-zA-Z_][\w.\[\]]*)\s*(\+=|-=|\*=|\/=|%=)\s*([^\n;]+)/g, (_, lhs, op, rhs) => {
    const baseOp = op[0];
    return `${lhs} = ${lhs} ${baseOp} (${rhs})`;
  });
  // Expand integer division (\)
  code = code.replace(/\\/g, "//");
  // Expand single-line PICO-8 if statements: if (cond) stmt
  code = code.replace(/^([ \t]*)if\s*\(([^)]+)\)\s*(?!then\b)(.+)$/gm, "$1if $2 then $3 end");
  return code;
}

// 3. Build 8x8 SVG sprites from __gfx__
function generateSprites(gfxLines) {
  const grid = Array.from({ length: 128 }, (_, y) => {
    const row = (gfxLines[y] || "").padEnd(128, "0");
    return row.split("").map((ch) => parseInt(ch, 16) || 0);
  });

  const costumes = [];
  const files = {};

  for (let id = 0; id < 256; id++) {
    const sx = (id % 16) * 8;
    const sy = Math.floor(id / 16) * 8;
    let rects = "";
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const col = grid[sy + py][sx + px];
        if (col !== 0) {
          rects += `<rect x="${px}" y="${py}" width="1" height="1" fill="${PICO_PALETTE[col]}"/>`;
        }
      }
    }
    // Only generate full SVG for non-empty sprites (or sprite 0/1)
    if (rects === "" && id > 1) continue;

    const svg = `<svg xmlns="http://w3.org" width="8" height="8" viewBox="0 0 8 8" shape-rendering="crispEdges">${rects}</svg>`;
    const hash = md5(svg);
    const filename = `${hash}.svg`;
    files[filename] = svg;
    costumes.push({
      assetId: hash,
      name: `spr_${id}`,
      md5ext: filename,
      dataFormat: "svg",
      rotationCenterX: 0,
      rotationCenterY: 0
    });
  }
  return { costumes, files };
}

// 4. Scratch 3.0 AST -> Block Compiler
class ScratchBuilder {
  constructor() {
    this.blocks = {};
    this.variables = {};
    this.lists = {};
    this.idCounter = 1;
    this.initBuiltins();
  }

  uid(prefix = "b") {
    return `${prefix}_${this.idCounter++}`;
  }

  ensureVar(name, initial = 0) {
    if (!this.variables[name]) {
      this.variables[name] = [this.uid("var"), name, initial];
    }
    return this.variables[name];
  }

  ensureList(name, items = []) {
    if (!this.lists[name]) {
      this.lists[name] = [this.uid("list"), name, items];
    }
    return this.lists[name];
  }

  litNum(val) {
    return [1, [4, String(val)]];
  }

  litStr(val) {
    return [1, [10, String(val)]];
  }

  addBlock(obj) {
    const id = this.uid();
    this.blocks[id] = {
      opcode: obj.opcode,
      next: null,
      parent: null,
      inputs: obj.inputs || {},
      fields: obj.fields || {},
      shadow: !!obj.shadow,
      topLevel: !!obj.topLevel,
      ...(obj.mutation ? { mutation: obj.mutation } : {})
    };
    if (obj.topLevel) {
      this.blocks[id].x = obj.x || 40;
      this.blocks[id].y = obj.y || 40;
    }
    for (const key in this.blocks[id].inputs) {
      const inp = this.blocks[id].inputs[key];
      if (Array.isArray(inp) && typeof inp[1] === "string" && this.blocks[inp[1]]) {
        this.blocks[inp[1]].parent = id;
      }
    }
    return id;
  }

  chain(ids) {
    const valid = ids.filter(Boolean);
    for (let i = 0; i < valid.length - 1; i++) {
      this.blocks[valid[i]].next = valid[i + 1];
      this.blocks[valid[i + 1]].parent = valid[i];
    }
    return valid[0] || null;
  }

  initBuiltins() {
    // Core PICO-8 state variables
    this.ensureVar("RET", 0);
    this.ensureVar("TMP_X", 0);
    this.ensureVar("TMP_Y", 0);
    this.ensureVar("SCALE", 2.8);

    // Build custom block: cls(col)
    this.defineProc("P8_cls %s", ["col"], [
      this.addBlock({ opcode: "pen_clear" })
    ]);

    // Build custom block: spr(n, x, y)
    const nParam = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["n", null] }, shadow: true });
    const xParam = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["x", null] }, shadow: true });
    const yParam = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["y", null] }, shadow: true });

    const costumeName = this.addBlock({
      opcode: "operator_join",
      inputs: { STRING1: this.litStr("spr_"), STRING2: [3, nParam, [10, "0"]] }
    });
    const switchCostume = this.addBlock({
      opcode: "looks_switchcostumeto",
      inputs: { COSTUME: [3, costumeName, [10, "spr_1"]] }
    });
    const setSize = this.addBlock({
      opcode: "looks_setsizeto",
      inputs: { SIZE: this.litNum(280) }
    });

    // Convert PICO-8 (x, y) to Scratch (-179..179)
    const sxSub = this.addBlock({ opcode: "operator_subtract", inputs: { NUM1: [3, xParam, [4, "0"]], NUM2: this.litNum(64) } });
    const sxMul = this.addBlock({ opcode: "operator_multiply", inputs: { NUM1: [2, sxSub], NUM2: this.litNum(2.8) } });
    const sySub = this.addBlock({ opcode: "operator_subtract", inputs: { NUM1: this.litNum(64), NUM2: [3, yParam, [4, "0"]] } });
    const syMul = this.addBlock({ opcode: "operator_multiply", inputs: { NUM1: [2, sySub], NUM2: this.litNum(2.8) } });

    const goXY = this.addBlock({
      opcode: "motion_gotoxy",
      inputs: { X: [2, sxMul], Y: [2, syMul] }
    });
    const stamp = this.addBlock({ opcode: "pen_stamp" });

    this.defineProc("P8_spr %s %s %s", ["n", "x", "y"], [switchCostume, setSize, goXY, stamp]);

    // Build custom block: rectfill(x0, y0, x1, y1, col)
    const rx0 = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["x0", null] }, shadow: true });
    const ry0 = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["y0", null] }, shadow: true });
    const rx1 = this.addBlock({ opcode: "argument_reporter_string_number", fields: { VALUE: ["x1", null] }, shadow: true });
