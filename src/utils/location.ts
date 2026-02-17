export type ConfigLocation = 'home' | 'repo';

export interface ResolvedConfig {
  location: ConfigLocation;
  configDir: string;
  manifestPath: string;
  gitRoot: string | null;
}
