import { parseNote, inline } from '../lib/md.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// 行内语法
assert.equal(inline('**粗** 和 [链接](https://a.com) 以及 `a<b`'), '<strong>粗</strong> 和 <a href="https://a.com">链接</a> 以及 a&lt;b');
assert.equal(inline('看 https://github.com/a/b_c，好'), '看 <a href="https://github.com/a/b_c">https://github.com/a/b_c</a>，好');
assert.equal(inline('[[笔记名|别名]] 和 [[文件夹/笔记]]'), '别名 和 笔记');

// 结构
const n = parseNote(`---
tags: x
---
# 标题
![[cover.png]]

第一段 **加粗**
## 小标题
> 引用一
> 引用二

- a
- b
1. one
2. two
![[pic.png]]
![[clip.mp4]]
最后一段
`);
assert.equal(n.title, '标题');
assert.equal(n.coverRef, 'cover.png');
assert.deepEqual(n.segments.map(s => s.type), ['html', 'image', 'video', 'html']);
assert.equal(n.segments[0].html, '<p>第一段 <strong>加粗</strong></p><h2>小标题</h2><blockquote>引用一<br>引用二</blockquote><ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>');
assert.deepEqual(n.segments[0].texts.map(x => x.t), ['第一段 加粗', '小标题', '引用一\n引用二', 'a', 'b', 'one', 'two']);
assert.deepEqual(n.segments[0].texts.map(x => x.type), ['unstyled', 'header-two', 'blockquote', 'unordered-list-item', 'unordered-list-item', 'ordered-list-item', 'ordered-list-item']);

// frontmatter cover 优先，正文第一张图不再当封面
const n2 = parseNote(`---\ncover: "[[c2.png]]"\n---\n# T\n![[p1.png]]\n文字`);
assert.equal(n2.coverRef, 'c2.png');
assert.equal(n2.segments[0].type, 'image');

// callout
const n3 = parseNote(`# T\n正文\n> [!tip] 提示\n> 内容`);
assert.equal(n3.segments[0].html, '<p>正文</p><blockquote><strong>提示</strong><br>内容</blockquote>');

// H1 之前的备注不进正文
const n4 = parseNote(`---\na: 1\n---\n> 发布前检查\n\n---\n# 真标题\n![[c.png]]\n正文`);
assert.equal(n4.title, '真标题');
assert.equal(n4.coverRef, 'c.png');
assert.deepEqual(n4.segments.map(s => s.type), ['html']);

// 真实文章
const art = readFileSync(process.argv[2], 'utf8');
const r = parseNote(art);
console.log('title:', r.title, '| cover:', r.coverRef, '| warnings:', r.warnings);
r.segments.forEach((s, i) => console.log(i, s.type, s.ref || s.texts.slice(0, 2).map(x => x.t.slice(0, 16)).join(' / ')));
console.log('ALL TESTS PASSED');
