const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
function load(file, imports = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => imports[name] || require(name), setTimeout, clearTimeout });
  return module.exports;
}
class MockMap {
  sources = new Map(); layers = new Map(); listeners = new Map(); controls = []; rendered = []; cameraMoves = 0; canvas = { style: {} };
  on(name, handler) { const set = this.listeners.get(name) || new Set(); set.add(handler); this.listeners.set(name, set); }
  off(name, handler) { this.listeners.get(name)?.delete(handler); }
  async emit(name, event = {}) { await Promise.all([...(this.listeners.get(name) || [])].map(fn => fn(event))); }
  isStyleLoaded() { return false; }
  addSource(id, options) { this.sources.set(id, { ...options, setData(data) { this.data = data; }, getClusterExpansionZoom: async () => 13 }); }
  getSource(id) { return this.sources.get(id); } removeSource(id) { this.sources.delete(id); }
  addLayer(layer) { this.layers.set(layer.id, layer); } getLayer(id) { return this.layers.get(id); } removeLayer(id) { this.layers.delete(id); }
  setFilter(id, filter) { this.layers.get(id).filter = filter; }
  getCanvas() { return this.canvas; } queryRenderedFeatures() { return this.rendered; }
  easeTo(options) { this.cameraMoves++; this.camera = options; }
  addControl(control) { this.controls.push(control); control.onAdd(this); }
  removeControl(control) { this.controls.splice(this.controls.indexOf(control), 1); control.onRemove(); }
}
class MockGeolocate {
  handlers = new Map(); removed = false;
  constructor(options) { this.options = options; }
  on(name, handler) { this.handlers.set(name, handler); }
  onAdd(map) { this.map = map; this.element = { addEventListener: (_name, fn) => this.capture = fn, removeEventListener: () => this.capture = null }; return this.element; }
  onRemove() { this.removed = true; this.map = undefined; }
  click() { let blocked = false; this.capture({ stopImmediatePropagation() { blocked = true; }, preventDefault() {} }); if (!blocked) this.requests = (this.requests || 0) + 1; }
  async success() { if (!this.map) return; await this.map.emit('movestart', { geolocateSource: true }); this.map.easeTo({ zoom: 13 }); this.handlers.get('geolocate')(); }
  error(code) { this.handlers.get('error')({ code }); }
}
(async () => {
  const { installStationLayers, stationFeatures } = load('station-layers.ts');
  const map = new MockMap(); let chosen = '', picking = false;
  const layers = installStationLayers(map, id => chosen = id, () => picking);
  const stations = [{ id: 'one', lng: -.3, lat: 43, availableFuels: ['E10'] }, { id: 'two', lng: .1, lat: 43.2, availableFuels: [] }];
  layers.update(stations); layers.select('one'); await map.emit('style.load');
  const source = map.getSource('fuel-stations');
  assert.equal(source.clusterRadius, 45); assert.equal(source.clusterMaxZoom, 12); assert.equal(source.data.features.length, 2);
  assert.equal(source.data.features[0].id, 'one'); assert.equal(source.data.features[0].geometry.coordinates[0], -.3);
  assert.equal(source.data.features[1].properties.hasFuel, false);
  assert.equal(map.layers.size, 4);
  layers.update(stations.slice(0, 1)); assert.equal(source.data.features.length, 1); assert.equal(map.cameraMoves, 0);
  map.rendered = [{ properties: { stationId: 'one' } }]; await map.emit('click', { point: {} }); assert.equal(chosen, 'one');
  picking = true; chosen = ''; await map.emit('click', { point: {} }); assert.equal(chosen, '');
  picking = false; map.rendered = [{ properties: { cluster: true, cluster_id: 1 }, geometry: { type: 'Point', coordinates: [0, 43] } }];
  await map.emit('click', { point: {} }); assert.equal(map.camera.zoom, 13);
  let resolveZoom; source.getClusterExpansionZoom = () => new Promise(resolve => resolveZoom = resolve);
  const pending = map.emit('click', { point: {} }); layers.update(stations); resolveZoom(14); await pending; assert.equal(map.cameraMoves, 1);
  map.sources.clear(); map.layers.clear(); await map.emit('style.load'); assert.equal(map.getSource('fuel-stations').data.features.length, 2);
  map.sources.clear(); map.layers.clear(); await map.emit('idle'); assert.equal(map.getSource('fuel-stations').data.features.length, 2);
  layers.remove(); assert.equal(map.sources.size, 0); assert.equal(map.listeners.get('click').size, 0);
  assert.equal(stationFeatures([]).features.length, 0);

  const { installGeolocation } = load('map-geolocation.ts', { 'maplibre-gl': { GeolocateControl: MockGeolocate } });
  const geoMap = new MockMap(), messages = []; const dispose = installGeolocation(geoMap, text => messages.push(text));
  let control = geoMap.controls[0]; assert.equal(control.requests, undefined); assert.equal(control.options.trackUserLocation, false); assert.equal(control.options.fitBoundsOptions.maxZoom, 13);
  control.click(); control.click(); assert.equal(control.requests, 1);
  await geoMap.emit('movestart', {}); assert.equal(control.removed, true); await control.success(); assert.equal(geoMap.cameraMoves, 0);
  control = geoMap.controls[0]; control.click(); await control.success(); assert.equal(geoMap.cameraMoves, 1); assert.ok(messages.at(-1).includes('64 · 65'));
  control.click(); control.error(1); assert.ok(messages.at(-1).includes('refusée')); assert.equal(geoMap.cameraMoves, 1);
  control.click(); control.error(3); assert.ok(messages.at(-1).includes('trop de temps'));
  dispose(); assert.equal(geoMap.controls.length, 0);
  console.log('Map behavior passed: source lifecycle, filter data, UUIDs, selection, cluster clicks/races, no camera reset, explicit one-shot location, denial/timeout and late-result cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
