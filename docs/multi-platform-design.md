# 多平台视频分发 · 设计稿（v0.2 规划）

> 状态：第 30 期（Grok Bot Day 3）工程文件已生成并校验，待审文案。知识站不在第一期范围。
> 第一版只做：视频、封面、文字正确上传。商单声明、定时、合集等放第二期。

## 目标

`mdldm-publish-assets` skill 产出一期的发布素材后，插件读取这一期的「发布包」，自动打开 6 个平台的上传页，依次上传视频和封面，填好标题、正文、标签和平台设置，**停在发布按钮前**，由人检查后手动点发布。

第一期平台：小红书、B 站、抖音、视频号、X、YouTube。

## 整体流程

```
成片 + 字幕
  └─ mdldm-publish-assets skill
       ├─ {序号}_{主题}_发布素材.md     （人看的，保持现状）
       └─ {序号}_{主题}_发布包.json     （新增，给插件读）
                 │
                 ▼
Chrome 插件侧边栏
  选一期 → 预检（字段齐全、文件能找到） → 一键填写
       └─ 依次打开 6 个上传页：先让视频开始上传，再填文字和设置
       └─ 每个平台一张状态卡：上传进度 / 已填 / 出错原因 / 重填
                 │
                 ▼
人逐个标签页检查 → 点发布
```

## 资源放哪：DOC 写稿，NAS 存工程

| 放在哪 | 放什么 | 原因 |
|---|---|---|
| DOC（Obsidian）`内容规划/自制内容/{序号}_{主题}_发布素材.md` | 写稿、审稿、制作备忘、口播骨架 | 方便在 Obsidian 里改，也能同步飞书 |
| NAS `视频导出/{系列}/{期}/` | 成片、字幕、定稿封面、`publish.json` | 两台工作机都能访问；大文件不进 Obsidian 库；插件只需要读这一个目录 |

每期的 NAS 工程目录固定成这样：

```
/Volumes/sata11-176XXXX6901/视频导出/Grokbot/day3/
  成片.mp4
  字幕.srt
  发布素材.md          ← DOC 稿件的备份
  封面/cover-3x4.png   ← 竖：小红书、抖音竖、视频号个人主页卡片
  封面/cover-4x3.png   ← 横：B 站、抖音横、视频号分享卡片
  封面/cover-16x9.jpg  ← YouTube（由 4:3 补模糊边生成）
  publish.json         ← 工程文件，插件只认它
```

**NAS 里的内容 = 已确认可发布。** 写稿在 DOC，进入发布环节由 skill 把成片、封面、稿件备份和 publish.json 放进 NAS。

规则：

- 发布素材 md 是草稿，`publish.json` 是最终要发出去的版本。文案定稿后由 skill 从 md 生成 `publish.json`。之后要改文案，先改 md，再让 skill 重新同步。
- `publish.json` 里的路径全部相对于工程目录。插件里配置一次 NAS 根目录（默认 `/Volumes/sata11-176XXXX6901/视频导出`），两台 Mac 只要挂载名一致就能直接用。
- 封面定稿后由 skill 复制进 `封面/`，固定命名为 `cover-3x4.png`、`cover-4x3.png`。

## 工程文件格式（`publish.json`）

样例见第 30 期：`视频导出/Grokbot/day3/publish.json`。

```jsonc
{
  "version": 1,
  "id": "grokbot-day3",
  "episode": 30,
  "name": "…",
  "source": "03-自媒体-AI博主/内容规划/自制内容/30_…_发布素材.md",   // 对应的 DOC 稿件
  "video": "成片.mp4",
  "subtitle": "字幕.srt",
  "source_backup": "发布素材.md",
  "covers": { "3x4": "封面/cover-3x4.png", "4x3": "封面/cover-4x3.png", "16x9": "封面/cover-16x9.jpg" },
  "platforms": {
    "bilibili": { "covers": ["4x3"],        "title": "", "desc": "", "tags": [] },
    "xhs":      { "covers": ["3x4"],        "title": "", "body": "", "topics": [] },
    "douyin":   { "covers": ["4x3", "3x4"], "title": "", "body": "", "topics": [] },
    "channels": { "covers": ["4x3", "3x4"], "shortTitle": "", "body": "", "topics": [] },
    "youtube":  { "covers": ["16x9"],       "title": "", "desc": "", "tags": [] },
    "x":        { "covers": [],             "text": "" }
  }
}
```

- `covers` 填比例键：小红书只用 3:4；抖音、视频号横竖都传；B 站只传 4:3；YouTube 用 16:9；X 不传。
- 某个平台这期不发，就不写这个平台的键。
- 字数上限和禁区由 `lib/bundle.js` 的 `validate()` 检查，skill 生成后、插件填写前都会跑一遍。

| 平台 | 字段与上限 |
|---|---|
| B 站 | 标题 ≤80，简介 ≤2000，标签 ≤10 个、每个 ≤20 字 |
| 小红书 | 标题 ≤20，正文 ≤1000；禁链接、禁微信号 |
| 抖音 | 标题 ≤30，简介 ≤1000 |
| 视频号 | 短标题 6–16，描述 ≤1000；禁链接、禁微信号 |
| YouTube | 标题 ≤100，简介 ≤5000，标签总长 ≤500，不能有 `<` `>` |
| X | 超过 280（中文按 2 计）需要 Premium |

第二期再加：`sponsored`（商单声明）、`schedule`（定时发布）、`collection` / `playlist`（合集）、B 站 `category` 和自制类型。

## 插件结构

```
manifest.json            加 debugger、tabs 权限和 6 个平台的 host_permissions
sidepanel.*              两个页签：「视频分发」「X 长文」（现有功能保留）
lib/bundle.js            读取 NAS 工程目录里的 publish.json、校验字段
lib/files.js             chrome.debugger → DOM.setFileInputFiles 把本地文件交给上传框
                         （大视频不经过 JS 内存；小图片如补边后的 16:9 封面仍用 DataTransfer）
lib/runner.js            打开标签页、按平台调度、汇总状态、失败可单独重试
adapters/
  bilibili.js  xhs.js  douyin.js  channels.js  youtube.js  x.js
lib/engine.js, md.js     现有的 X 长文功能，不动
```

每个适配器都实现同样的接口，平台之间互不影响，某个平台改版只需要修对应的那个文件：

```js
export default {
  id: 'bilibili',
  name: 'B 站',
  uploadUrl: 'https://member.bilibili.com/platform/upload/video/frame',
  match: (url) => boolean,
  async fill(ctx) { /* 传视频 → 等出现编辑表单 → 传封面 → 填文字 → 设置 → 检查 */ },
};
```

`ctx` 提供：发布包里这个平台的字段、解析好的文件路径、在页面里执行代码的 `exec`、上传文件的 `setFiles`、写日志的 `log`。

## 平台设置对照

| 设置 | B 站 | 小红书 | 抖音 | 视频号 | YouTube | X |
|---|---|---|---|---|---|---|
| 封面 | 4:3 | 3:4 | 3:4 | 3:4 | 4:3 补成 16:9 | — |
| 商业推广声明 | ✓ | ✓ | ✓ | 有就勾 | 付费推广 ✓ | — |
| 合集 / 播放列表 | 合集 | — | 合集 | 合集 | 播放列表 | — |
| 分区 / 类型 | 分区 + 自制 | — | — | — | — | — |
| 定时发布 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## 需要配套修改的 skill

`mdldm-publish-assets` 的改动：

1. 补写视频号、YouTube、X 三个平台的文案。
2. 封面定稿后，复制到 NAS 工程目录的 `封面/`。
3. 文案定稿后生成 `publish.json`，并用 `validate()` 校验通过。

## 开发顺序

1. 发布包格式 + skill 改造 + 用第 32 期做一份样例发布包
2. 插件框架：读取发布包、预检、debugger 上传、标签页调度、状态卡
3. B 站适配器（用它把整条链路跑通）
4. 小红书、抖音
5. 视频号、YouTube、X

每个适配器都对着真实的上传页开发和验证，只填写、不发布。

## 第二期再做

- 发布后从各平台抓回链接，回填到发布素材 md
- 评论区置顶
- 知识站
