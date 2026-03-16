const fs = require('fs').promises;
const path = require('path');

class ManifestCache {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(process.cwd(), '.wweb_cache');
        this.ttlMs = options.ttlMs || 6 * 60 * 60 * 1000; // 6 часов по умолчанию
        this.manifestFile = path.join(this.cacheDir, 'manifest.json');
        this.metaFile = path.join(this.cacheDir, 'manifest.meta.json');
        this.enabled = options.enabled !== false;
    }

    async ensureDir() {
        try {
            await fs.access(this.cacheDir);
        } catch {
            await fs.mkdir(this.cacheDir, { recursive: true });
        }
    }

    async get() {
        if (!this.enabled) return null;

        try {
            const [dataRaw, metaRaw] = await Promise.all([
                fs.readFile(this.manifestFile, 'utf8'),
                fs.readFile(this.metaFile, 'utf8')
            ]);

            const content = JSON.parse(dataRaw);
            const meta = JSON.parse(metaRaw);
            const isFresh = (Date.now() - meta.timestamp) < this.ttlMs;

            return { content, meta, isFresh };
        } catch {
            return null;
        }
    }

    async set(content, version) {
        if (!this.enabled) return;

        await this.ensureDir();
        const meta = {
            version,
            timestamp: Date.now(),
            cachedAt: new Date().toISOString()
        };

        await Promise.all([
            fs.writeFile(this.manifestFile, typeof content === 'string' ? content : JSON.stringify(content), 'utf8'),
            fs.writeFile(this.metaFile, JSON.stringify(meta), 'utf8')
        ]);
    }

    async invalidate() {
        try {
            await Promise.all([
                fs.unlink(this.manifestFile),
                fs.unlink(this.metaFile)
            ]);
            return true;
        } catch {
            return false;
        }
    }

    async getInfo() {
        const cached = await this.get();
        if (!cached?.meta) return { exists: false };

        const ageMs = Date.now() - cached.meta.timestamp;
        return {
            exists: true,
            version: cached.meta.version,
            ageMinutes: Math.round(ageMs / 60000),
            ttlMinutes: this.ttlMs / 60000,
            isFresh: cached.isFresh,
            remainingMinutes: Math.max(0, Math.round((this.ttlMs - ageMs) / 60000))
        };
    }
}

module.exports = ManifestCache;