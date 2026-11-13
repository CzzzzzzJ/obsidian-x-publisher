# 各平台上传页实测记录

> 2026-11-04 用第 30 期（Grok Bot Day 3，1698×1080 横屏，17:48，1.55GB）在真实上传页跑通。
> 全部用 chrome.debugger（CDP）完成：文件用 `DOM.setFileInputFiles` 交本地路径，文字用 `Input.insertText` + 真实回车，
> 需要悬停/点击的地方用 `Input.dispatchMouseEvent`。开发时用 `tools/` 下的桥接脚本驱动。

## 后台模式与定时发布（v0.2.1，2026-11-04 用第 31 期情绪之城实测）

- 填写流程跑在扩展后台（service worker），上传页用 `active:false` 在后台打开，调试器开 `Emulation.setFocusEmulationEnabled` 让后台页也能正常输入。
- 后台标签页不渲染画面：**B 站封面编辑器**（要画布裁剪）在后台做不成，改为 `withFocus` 短暂切到前台；其余平台（小红书悬停编辑封面、抖音、视频号、YouTube、X）在后台都正常。
- 每个封面、定时步骤都回读确认，避免「日志说成功、实际没设上」。
- 关含未保存内容的上传页会弹「离开此网站？」，会卡住整个浏览器的消息响应；开发时关标签页要先处理掉这个弹窗。

| 平台 | 定时控件 | 做法 |
|---|---|---|
| B 站 | `.time-container` 开关 + 自定义日历/时间面板（时区默认 UTC+08:00） | 开关 `.click()`；日期格子、时/分列表要合成完整鼠标事件（`fire`）；跨月点 `.next-btn-day` |
| 小红书 | `.post-time-switch-container` 开关 + 可输入的日期框 | 开关合成鼠标事件；框里全选后输入 `2026-11-05 18:00` 回车 |
| 抖音 | 「定时发布」单选 + Semi 日期框（2 小时后～14 天内） | 输入 `2026-11-05 18:00` 回车，Esc 收起日历 |
| 视频号 | 「定时」单选 + WeUI 日历 + 时/分两列 | 日期框合成鼠标事件打开，点日期 `<a>`，再点时、分 |
| YouTube | 最后一步「公开范围」→「安排时间」 | 先选「不是面向儿童」，点 `button[test-id=REVIEW]`，展开 `#second-container-expand-button`，日期弹窗输入 `2026年11月5日`，时间框输入 `18:00`；时区默认 GMT+0800 |
| X | 发帖框 `scheduleOption` → 月/日/年/时/分 5 个 select | 原生 setter 设值 + change，点 `scheduledConfirmationPrimaryAction`，确认出现「Will send on…」 |

## 通用经验

- **文件输入框**：用 JS 表达式找到元素，再按 `objectId` 交给 `DOM.setFileInputFiles`（`tools/setfiles.mjs` 的 `setFilesByExpr`）。这样能穿透 Shadow DOM，大视频也不经过 JS 内存。
- **文字**：React/Vue 受控输入框用 focus + `Input.insertText` 最稳；多行正文逐行插入，行间按真实回车。
- **话题/标签**：大多数平台要靠联想下拉选中才算真话题；只选「完全同名」的项，没有同名就保留为普通文字并在报告里提示。
- **封面**：小红书、视频号要等视频**上传完**才能编辑封面；B 站、抖音上传中就能改。
- **调试器限制**：页面里有别的扩展注入的 `chrome-extension://` iframe 时无法 attach（YouTube 上的 YouMind 侧边栏）。只在该标签页移除那个节点即可（刷新会恢复）。正式插件里要给出提示或自动处理。
- **带宽**：6 个平台同时传 1.5GB，各家速度掉到 0.5–3MB/s。插件可以考虑排队上传或提示预计时间。

## B 站 `member.bilibili.com/platform/upload/video/frame`

| 项 | 做法 |
|---|---|
| 视频 | `.bcc-upload-wrapper input[type=file]` |
| 标题 | `input[placeholder="请输入稿件标题"]`，原生 setter + input 事件 |
| 简介 | 第一个 `.ql-editor`（placeholder 以「填写更全面」开头），`closest('.ql-container').__quill.setText()` |
| 标签 | 先点 `.tag-pre-wrp .label-item-v2-container svg.close` 删掉自动标签；再在 `input[placeholder="按回车键Enter创建标签"]` 逐个 insertText + 回车。**「AIAgent」会被静默拒绝** |
| 封面 | 点 `.cover-module-main .cover-empty` 打开「封面制作」→ 勾「双比例同步改动」（`.operation .sync label.sync-checkbox`）→ `input[type=file][accept^="image/png"]` 传 4:3 → 点文字为「完成」的 `div.button.submit`。16:9 个人空间封面会从 4:3 裁上下边 |
| 未处理 | 创作声明（必填）、分区（会按内容自动选「人工智能」） |

## 小红书 `creator.xiaohongshu.com/publish/publish?source=official&target=video`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file]`（页面渲染后才出现） |
| 标题 | `input[placeholder="填写标题会有更多赞哦"]`，原生 setter |
| 正文 | `.tiptap.ProseMirror`，逐行 insertText + 回车 |
| 话题 | 输入 `#话题` → 等 1.5s → 点 `.item` 中首行完全等于 `#话题` 的项，生成 `a.tiptap-topic`。「Prompt」没有联想结果 |
| 封面 | 视频传完后：真实鼠标悬停 `.cover .default` → 点 `.cover-edit-entry-text`（编辑封面）→ 传图 `input[accept*=image]` → 左侧「裁剪」→ 比例选「3:4」（横屏视频默认 4:3 会裁掉竖封面）→ 完成。出现「封面效果评估通过」 |
| 弹窗 | 首次会有「PK 封面」引导，点「我知道了」 |

## 抖音 `creator.douyin.com/creator-micro/content/upload`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file]`（唯一一个） |
| 标题 | `input[placeholder="填写作品标题，为作品获得更多流量"]`，focus + insertText（≤30） |
| 简介 | `.editor-kit-container[contenteditable=true]`，逐行 insertText + 回车 |
| 话题 | **最多 5 个**（第 6 个起不会变成话题）。逐字输入 `#话题`（整串 insertText 时联想会停在第一个字的结果）→ 用**真实鼠标**点 `[class*=mention-suggest-item-container] > div > [class*=tag-hash]` 中首行完全匹配的项（2026-11-12：外层 container 包着全部项，`.click()` 不再生成话题）。生成后编辑器里是 `[data-mention]` 节点 |
| 封面 | 点「选择封面」打开弹窗（「设置横封面」「设置竖封面」两个页签）。**要用标签文字为「上传封面」的那个 `semi-upload-hidden-input`**（按页面顺序是第 4 个文件输入框，第 2 个是「生成参考图」，别传错）。横页签传 4:3，切到竖页签再传 3:4（切换时会先把横封面同步过去，再覆盖）→ 完成 |
| 未处理 | 合集、自主声明 |

## 视频号 `channels.weixin.qq.com/platform/post/create`

整个表单在 `wujie-app` 的 Shadow DOM 里：`R = document.querySelector('wujie-app').shadowRoot`。

| 项 | 做法 |
|---|---|
| 视频 | `R` 里的 `input[type=file][accept^=video]` |
| 短标题 | `input[placeholder="填写短标题有机会获得更多流量"]`，focus + insertText |
| 描述 | `.input-editor`（contenteditable），逐行 insertText + 回车 |
| 话题 | 直接输入 `#话题 `（空格分隔），自动高亮为话题，不用选联想 |
| 封面 | 视频传完后：点 `.vertical-cover-wrap .edit-btn`（个人主页卡片 3:4）→ 传图 → 确认；点 `.horizon-cover-wrap .edit-btn`（分享卡片 4:3）会先弹「使用此素材作为封面？」气泡，点「直接编辑」→ 传图 → 确认 |
| 未处理 | 原创声明、合集、位置（默认带了「杭州市」） |

## YouTube `studio.youtube.com/.../videos/upload`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file][name=Filedata]`；上传后自动「已保存为私享视频」 |
| 标题/说明 | `#textbox[contenteditable]` 第 1、2 个；selectAllChildren 后 insertText，说明逐行回车 |
| 缩略图 | `input[type=file]` 且 accept 含 image；用 `cover-16x9.jpg`（1920×1080，≤2MB） |
| 标签 | 点 `#toggle-button`（显示更多）→ `input[aria-label="标签"]` 逐个 insertText + 回车（直接插入带逗号的整串不会切分） |
| 未处理 | 「是否面向儿童」（必填）、播放列表、公开范围 |
| 注意 | 页面有 YouMind 注入的 iframe 时调试器挂不上 |

## X `x.com/compose/post`

| 项 | 做法 |
|---|---|
| 正文 | `[data-testid=tweetTextarea_0]`，逐行 insertText + 回车 |
| 视频 | `input[data-testid=fileInput]`（accept 含 video/mp4）；17:48 的视频可以挂上（账号有 Premium） |
| 注意 | 不点 Post；关掉对话框会丢失 |
