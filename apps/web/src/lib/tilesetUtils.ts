/**
 * Tileset Utilities
 */

export type SplitTile = {
    id: string;
    dataUrl: string;
    x: number;
    y: number;
    row: number;
    col: number;
};

/**
 * Splits a tileset image into individual tiles based on configuration.
 * Returns a Promise that resolves to an array of split tiles.
 */
export function splitTilesetImage(
    dataUrl: string,
    config: {
        tileWidth: number;
        tileHeight: number;
        margin?: number;
        spacing?: number;
    }
): Promise<SplitTile[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const margin = config.margin || 0;
                const spacing = config.spacing || 0;
                const tileWidth = config.tileWidth;
                const tileHeight = config.tileHeight;

                const cols = Math.max(1, Math.floor((img.width - margin + spacing) / (tileWidth + spacing)));
                const rows = Math.max(1, Math.floor((img.height - margin + spacing) / (tileHeight + spacing)));
                const tiles: SplitTile[] = [];

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Could not get 2D context'));
                    return;
                }

                canvas.width = tileWidth;
                canvas.height = tileHeight;

                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const sx = margin + c * (tileWidth + spacing);
                        const sy = margin + r * (tileHeight + spacing);

                        // Clear canvas for transparency support
                        ctx.clearRect(0, 0, tileWidth, tileHeight);

                        // Draw the specific tile
                        ctx.drawImage(img, sx, sy, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);

                        const tileDataUrl = canvas.toDataURL('image/png');
                        tiles.push({
                            id: `${r}:${c}`,
                            dataUrl: tileDataUrl,
                            x: c * tileWidth,
                            y: r * tileHeight,
                            row: r,
                            col: c
                        });
                    }
                }

                resolve(tiles);
            } catch (e) {
                reject(e);
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        img.src = dataUrl;
    });
}
