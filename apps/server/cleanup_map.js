/**
 * Vollständige Map-Bereinigung (COMPLETE RESET)
 * 
 * Dieses Skript macht einen KOMPLETTEN Reset der office-Map:
 * 1. Löscht ALLE MapTilesets aus DB
 * 2. Löscht ALLE Chunks und Layer
 * 3. Löscht ALLE Zonen
 * 4. Bereinigt map.meta komplett (assets, tilesets, etc.)
 * 5. Löscht physische Asset-Dateien im /packs/ Ordner
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function cleanupMap() {
  try {
    console.log('🔍 Suche Map und Tenant...');
    
    const tenant = await prisma.tenant.findUnique({ 
      where: { slug: 'default' } 
    });
    
    if (!tenant) {
      console.error('❌ Tenant "default" nicht gefunden!');
      process.exit(1);
    }
    
    const map = await prisma.map.findFirst({ 
      where: { 
        name: 'office', 
        tenantId: tenant.id 
      } 
    });
    
    if (!map) {
      console.error('❌ Map "office" nicht gefunden!');
      process.exit(1);
    }
    
    console.log(`✅ Map gefunden: ${map.id}`);
    
    // 1. Lösche ALLE MapTilesets (kompletter Reset)
    console.log(`\n🧹 Lösche ALLE MapTilesets...`);
    
    const deletedTilesets = await prisma.mapTileset.deleteMany({
      where: {
        mapId: map.id
      }
    });
    console.log(`✅ ${deletedTilesets.count} MapTileset(s) gelöscht`);
    
    // 2. Lösche ALLE Zonen
    console.log('\n🧹 Lösche ALLE Zonen...');
    const deletedZones = await prisma.zone.deleteMany({
      where: { mapId: map.id }
    });
    console.log(`✅ ${deletedZones.count} Zone(n) gelöscht`);
    
    // 3. Bereinige map.meta KOMPLETT
    console.log('\n🧹 Bereinige map.meta KOMPLETT...');
    const meta = map.meta || {};
    const oldAssetCount = Array.isArray(meta.assets) ? meta.assets.length : 0;
    const oldTilesetCount = Array.isArray(meta.tilesets) ? meta.tilesets.length : 0;
    
    // Behalte nur essenzielle Felder, lösche alles andere
    const cleanMeta = {
      backgroundColor: meta.backgroundColor || '#202020',
      spawn: meta.spawn || { x: 400, y: 400 },
      tilesets: [],
      assets: []
    };
    
    console.log(`✅ Assets gelöscht: ${oldAssetCount}`);
    console.log(`✅ Tilesets gelöscht: ${oldTilesetCount}`);
    
    // 4. Layer und Chunks komplett löschen
    console.log('\n🧹 Lösche ALLE MapChunks und MapLayers...');
    
    const layers = await prisma.mapLayer.findMany({
      where: { mapId: map.id },
      include: { chunks: true }
    });
    
    let totalChunks = 0;
    for (const layer of layers) {
      const deletedChunks = await prisma.mapChunk.deleteMany({
        where: { layerId: layer.id }
      });
      totalChunks += deletedChunks.count;
    }
    console.log(`✅ ${totalChunks} MapChunk(s) gelöscht`);
    
    const deletedLayers = await prisma.mapLayer.deleteMany({
      where: { mapId: map.id }
    });
    console.log(`✅ ${deletedLayers.count} MapLayer(s) gelöscht`);
    
    // 5. Lösche physische Asset-Dateien im /packs/ Ordner
    console.log('\n🧹 Lösche physische Asset-Dateien...');
    const packsDir = path.join(__dirname, '../../public/packs');
    
    if (fs.existsSync(packsDir)) {
      const entries = fs.readdirSync(packsDir);
      let deletedDirs = 0;
      let deletedFiles = 0;
      
      for (const entry of entries) {
        const fullPath = path.join(packsDir, entry);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          // Lösche Pack-Ordner (z.B. a41042b0-...)
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            deletedDirs++;
            console.log(`   🗑️  ${entry}/`);
          } catch (err) {
            console.warn(`   ⚠️  Konnte ${entry}/ nicht löschen: ${err.message}`);
          }
        } else if (stat.isFile()) {
          // Lösche lose Dateien
          try {
            fs.unlinkSync(fullPath);
            deletedFiles++;
            console.log(`   🗑️  ${entry}`);
          } catch (err) {
            console.warn(`   ⚠️  Konnte ${entry} nicht löschen: ${err.message}`);
          }
        }
      }
      
      console.log(`✅ ${deletedDirs} Ordner und ${deletedFiles} Dateien gelöscht`);
    } else {
      console.log('   ℹ️  /packs/ Ordner existiert nicht');
    }
    
    // 6. Update map.meta
    await prisma.map.update({
      where: { id: map.id },
      data: { meta: cleanMeta }
    });
    console.log('✅ map.meta aktualisiert');
    
    // 7. Zeige finalen Status
    console.log('\n📊 Map Status nach Bereinigung:');
    
    const remainingTilesets = await prisma.mapTileset.count({ where: { mapId: map.id } });
    const remainingLayers = await prisma.mapLayer.count({ where: { mapId: map.id } });
    const remainingZones = await prisma.zone.count({ where: { mapId: map.id } });
    const updatedMap = await prisma.map.findUnique({ where: { id: map.id } });
    const metaAssets = Array.isArray(updatedMap.meta?.assets) ? updatedMap.meta.assets.length : 0;
    const metaTilesets = Array.isArray(updatedMap.meta?.tilesets) ? updatedMap.meta.tilesets.length : 0;
    
    console.log(`   MapTilesets: ${remainingTilesets}`);
    console.log(`   MapLayers: ${remainingLayers}`);
    console.log(`   Zones: ${remainingZones}`);
    console.log(`   meta.assets: ${metaAssets}`);
    console.log(`   meta.tilesets: ${metaTilesets}`);
    
    console.log('\n✅ KOMPLETTE BEREINIGUNG ABGESCHLOSSEN!');
    console.log('\n💡 Nächste Schritte:');
    console.log('   1. Server neu starten: docker compose -f docker-compose.prod.yml restart server');
    console.log('   2. Browser Cache leeren (Ctrl+Shift+R / Cmd+Shift+R)');
    console.log('   3. Seite neu laden und Editor öffnen');
    console.log('   4. Im Editor neue Tilesets hochladen und Map neu aufbauen');
    
  } catch (error) {
    console.error('❌ FEHLER:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupMap();

