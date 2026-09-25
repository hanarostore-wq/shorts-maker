import fs from "node:fs";
import path from "node:path";
export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
  }
  load() {
    if (!fs.existsSync(this.file)) return null;
    const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (data.version !== 1) throw Error("지원하지 않는 저장 형식");
    return data;
  }
  save(value) {
    const tmp = this.file + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
  log(row) {
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(
      path.join(this.dir, "decisions-" + day + ".jsonl"),
      JSON.stringify(row) + "\n",
      { mode: 0o600 },
    );
  }
}
