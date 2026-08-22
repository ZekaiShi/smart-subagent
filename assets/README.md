# assets

Plugin preview images, hosted here so the awesome-dsh-plugin market can link
them via `raw.githubusercontent.com/ZekaiShi/smart-subagent/main/assets/...`.

## 放图指引 / Where generated previews go

把生成的预览图放到本目录，命名建议：

- `assets/hero.png` — 主展示图（GitHub 社交预览 / 市场卡片，推荐 1280×640 或 4:3）
- `assets/demo.png` — 可选的功能示意（如路由流程概念图）

生成后用 `git add assets/` 提交到仓库 main 分支，market 里的截图
（`data/screenshots.json`）会自动从 `raw.githubusercontent.com/...` 加载。
