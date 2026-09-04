import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const packageName = 'evo-subagent';
const outputPath = resolve('assets/npm-downloads.svg');
const registryEndpoint = `https://registry.npmjs.org/${packageName}`;

const registryResponse = await fetch(registryEndpoint, {
  headers: { Accept: 'application/json', 'User-Agent': `${packageName}-download-chart` },
});

if (!registryResponse.ok) {
  throw new Error(`npm registry returned ${registryResponse.status} ${registryResponse.statusText}`);
}

const registry = await registryResponse.json();
const publishedOn = String(registry.time?.created ?? '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) {
  throw new Error('npm registry did not provide a valid package creation date');
}

const today = new Date().toISOString().slice(0, 10);
const endpoint = `https://api.npmjs.org/downloads/range/${publishedOn}:${today}/${packageName}`;
const response = await fetch(endpoint, {
  headers: { Accept: 'application/json', 'User-Agent': `${packageName}-download-chart` },
});
if (!response.ok) {
  throw new Error(`npm downloads API returned ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const rows = Array.isArray(payload.downloads) ? payload.downloads : [];
if (!rows.length) {
  throw new Error('npm downloads API returned no daily data');
}

const width = 960;
const height = 360;
const pad = { top: 68, right: 46, bottom: 68, left: 62 };
const chartWidth = width - pad.left - pad.right;
const chartHeight = height - pad.top - pad.bottom;
const dailyDownloads = rows.map((row) => Number(row.downloads) || 0);
const values = dailyDownloads.reduce((cumulative, value) => {
  cumulative.push((cumulative.at(-1) ?? 0) + value);
  return cumulative;
}, []);
const max = Math.max(1, ...values);
const total = values.at(-1) ?? 0;
const x = (index) => pad.left + (index / Math.max(1, rows.length - 1)) * chartWidth;
const y = (value) => pad.top + chartHeight - (value / max) * chartHeight;
const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
const area = `${pad.left},${pad.top + chartHeight} ${points} ${pad.left + chartWidth},${pad.top + chartHeight}`;
const labels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].map((index) => ({
  x: x(index),
  label: rows[index].day.slice(5),
}));
const grid = [0, 0.5, 1].map((ratio) => {
  const position = pad.top + chartHeight - ratio * chartHeight;
  return `<line x1="${pad.left}" y1="${position}" x2="${pad.left + chartWidth}" y2="${position}" /><text x="${pad.left - 12}" y="${position + 5}" text-anchor="end">${Math.round(max * ratio)}</text>`;
}).join('');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">evo-subagent cumulative npm downloads</title>
  <desc id="desc">Cumulative npm downloads for evo-subagent since its first release, generated automatically from the npm downloads API.</desc>
  <defs>
    <linearGradient id="background" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0b1020"/><stop offset="1" stop-color="#172554"/></linearGradient>
    <linearGradient id="line" x1="0" x2="1"><stop stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#38bdf8" stop-opacity=".36"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="18" fill="url(#background)"/>
  <text x="${pad.left}" y="36" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="22" font-weight="700">cumulative npm downloads</text>
  <text x="${pad.left}" y="56" fill="#a5b4fc" font-family="system-ui, sans-serif" font-size="13">evo-subagent · since ${rows[0].day} · ${total.toLocaleString('en-US')} total</text>
  <g stroke="#64748b" stroke-opacity=".35" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="12">${grid}</g>
  <polygon points="${area}" fill="url(#area)"/>
  <polyline points="${points}" fill="none" stroke="url(#line)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="12">${labels.map(({ x: position, label }) => `<text x="${position}" y="${height - 30}" text-anchor="middle">${label}</text>`).join('')}</g>
  <circle cx="${x(rows.length - 1)}" cy="${y(values.at(-1))}" r="6" fill="#22d3ee" stroke="#e0f2fe" stroke-width="3"/>
</svg>\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, 'utf8');
console.log(`Wrote ${outputPath} from ${rows.length} npm download data points.`);
