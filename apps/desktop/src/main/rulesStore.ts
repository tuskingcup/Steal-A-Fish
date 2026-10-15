import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { defaultRulesConfig, parseRulesConfig, type RulesConfig } from "@saf/core";

/**
 * rules.json in userData. The settings UI and hand edits share this one file.
 * Invalid content never replaces the last valid rules.
 */
export class RulesStore {
  private current: RulesConfig;
  private watcher: FSWatcher | null = null;
  private lastWrite = 0;

  constructor(
    private readonly path: string,
    private readonly onChange: (config: RulesConfig) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.current = this.loadOrCreate();
  }

  get(): RulesConfig {
    return this.current;
  }

  save(input: unknown): RulesConfig {
    const config = parseRulesConfig(input);
    this.lastWrite = Date.now();
    writeFileSync(this.path, JSON.stringify(config, null, 2) + "\n", "utf8");
    this.current = config;
    this.onChange(config);
    return config;
  }

  watch(): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    this.watcher = watch(this.path, () => {
      if (Date.now() - this.lastWrite < 500) return; // our own save
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.reload(), 200);
    });
  }

  close(): void {
    this.watcher?.close();
  }

  private reload(): void {
    try {
      this.current = parseRulesConfig(JSON.parse(readFileSync(this.path, "utf8")));
      this.onChange(this.current);
    } catch (err) {
      this.onError(`rules.json is invalid, keeping previous rules: ${String(err)}`);
    }
  }

  private loadOrCreate(): RulesConfig {
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(defaultRulesConfig, null, 2) + "\n", "utf8");
      return defaultRulesConfig;
    }
    try {
      return parseRulesConfig(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (err) {
      this.onError(`rules.json is invalid, using defaults: ${String(err)}`);
      return defaultRulesConfig;
    }
  }
}
