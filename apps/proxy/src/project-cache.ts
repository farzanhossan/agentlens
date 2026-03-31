// src/project-cache.ts
interface CacheEntry {
  valid: boolean;
  expiresAt: number;
}

export class ProjectCache {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly validationUrl: string | undefined,
    private readonly ttlMs: number,
  ) {}

  async isValid(projectId: string): Promise<boolean> {
    // Standalone mode: no validation URL, trust all project IDs
    if (!this.validationUrl) return true;

    const now = Date.now();
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > now) {
      return cached.valid;
    }

    let valid: boolean;
    try {
      const res = await fetch(`${this.validationUrl}/${projectId}`);
      valid = res.ok;
    } catch {
      valid = false;
    }

    this.cache.set(projectId, { valid, expiresAt: now + this.ttlMs });
    return valid;
  }
}
