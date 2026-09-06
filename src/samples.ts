export const welcome = `# 好的想法，从这里开始。

欢迎使用 **Luma Editor**，你的轻量代码与 Markdown 工作台。

专注写作，流畅编码。左侧编辑，右侧即时呈现。

## 为专注而设计

- **随心编辑** — 多标签、语法高亮与多光标
- **一键格式化** — 让代码重新变得井然有序
- **实时预览** — Markdown 写作所见即所得
- **本地优先** — 文件与未保存的草稿留在这台 Mac

## 让代码，清晰一点

\`\`\`typescript
const inspiration = {
  name: "Luma Editor",
  purpose: "Make room for your ideas.",
  ready: true,
};

function createSomething() {
  return inspiration;
}
\`\`\`

> 打开一个文件夹，或者按 ⌘ N 开始新文件。
> 每一个大项目，都从一行文字开始。

## 触手可及的快捷操作

| 操作 | 快捷键 |
| --- | --- |
| 打开文件 | ⌘ O |
| 快速打开 | ⌘ P |
| 命令面板 | ⇧ ⌘ P |
| 格式化文档 | ⇧ ⌥ F |
| Markdown 预览 | ⇧ ⌘ M |
| 查找 / 替换 | ⌘ F / ⌥ ⌘ F |

---

这是一个可编辑的示例。按 **⌘ S** 将它保存到你的电脑。
`;
export const sampleCode = `// 试试 ⇧ ⌥ F，让代码自动整理。
// ⌘ D 选中下一个相同单词，⌘ / 切换注释。

type Project = {
  name: string;
  language: string;
  favorite: boolean;
};

const projects: Project[] = [
  { name: "Luma Editor", language: "TypeScript", favorite: true },
  { name: "下一个灵感", language: "Markdown", favorite: false },
];

function findFavorites(items: Project[]): string[] {
  return items
    .filter((project) => project.favorite)
    .map((project) => project.name);
}

console.log(findFavorites(projects));
`;
