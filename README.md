# Luma Editor 使用说明

一个借鉴 Sublime 操作习惯的本地代码与 Markdown 编辑器。

## 开始使用

双击同目录下的 **Luma Editor.app**。也可以将它拖入「应用程序」文件夹，之后从启动台或 Spotlight 打开。应用已包含运行环境，无须安装 Node.js。

本次提供的是 **macOS Apple 芯片（arm64）版本**，已在这台 macOS 26.6.2 电脑上运行验证。它是本地构建的应用，未进行 Apple 开发者公证，尚未验证 Intel Mac 或其他系统。

首次启动会打开两个可编辑示例：「欢迎.md」和「示例.ts」。它们属于本地草稿，按 ⌘ S 可以保存到你选择的位置。

## 日常编辑

- 多标签和文件夹浏览，支持按文件名快速打开项目文件。
- 多语言语法高亮、行号、代码折叠、括号配对、自动缩进和代码缩略图。
- 查找替换、正则查找、多光标、选中相同单词、注释切换、撤销与重做。
- Markdown 源码编辑与实时分屏预览；提供标题、加粗、斜体、链接、代码块、列表和引用按钮。
- 可调整字号、缩进、换行、代码缩略图、保存时格式化和深浅色主题。
- 文件修改后显示未保存标记；关闭时提示保存、取消或放弃修改。

| 操作 | 快捷键 |
| --- | --- |
| 新建文件 | ⌘ N |
| 打开文件 | ⌘ O |
| 打开文件夹 | ⇧ ⌘ O |
| 保存 / 另存为 | ⌘ S / ⇧ ⌘ S |
| 关闭标签页 | ⌘ W |
| 快速打开 | ⌘ P |
| 命令面板 | ⇧ ⌘ P |
| 格式化文档 | ⇧ ⌥ F |
| Markdown 预览 | ⇧ ⌘ M |
| 查找 / 替换 | ⌘ F / ⌥ ⌘ F |
| 切换文件侧栏 | ⌘ B |
| 选中下一个相同单词 | ⌘ D |
| 切换行注释 | ⌘ / |
| 撤销 / 重做 | ⌘ Z / ⇧ ⌘ Z |
| 设置 | ⌘ , |

点击右下角语言名称可以手动选择语言。新建的纯文本在保存为 `.java`、`.json`、`.md` 等文件后会自动识别。代码缩略图在 Markdown 分屏预览时自动隐藏，为正文留出宽度。

## 格式化语言范围

**可编辑任何语言的 UTF-8 文本；语法格式化取决于对应格式化器。** 不存在一个内置规则能正确格式化所有语言，未知语言会明确提示配置工具，不会把简单去空格冒充格式化。

内置 22 个语言模式：JavaScript、JSX、TypeScript、TSX、JSON、JSONC、HTML、CSS、SCSS、Less、Markdown、MDX、YAML、GraphQL、Vue、Angular HTML、Handlebars、Java、XML、PHP、TOML、SQL。

Vue 默认使用 HTML 高亮和 Vue 格式化；JSX/TSX 使用相应的 JavaScript/TypeScript 编辑模式。SQL 使用通用 SQL 方言，特定数据库扩展语法可能需要外部工具。

应用会自动发现本机的 Ruff/Black、gofmt、rustfmt、clang-format、swift-format 和 shfmt。本机当前已实际验证 **C、C++、C# 和 Swift**；Python、Go、Rust、Shell 需先安装对应工具，或自行配置。设置面板会显示实际可用状态。

其他语言：进入「设置 → 接入其他语言的格式化工具」，填写语言 ID、可执行程序与参数。程序必须从标准输入读取代码，将格式化结果写入标准输出。

例如，已安装 Ruff 时可填写：

```text
语言 ID：python
程序：/opt/homebrew/bin/ruff
参数：["format", "--isolated", "--stdin-filename", "{filepath}", "-"]
```

`{filepath}` 会替换成保留原文件名和扩展名的临时副本路径。参数是 JSON 字符串数组，不支持 Shell 管道或重定向。设置的自定义工具优先于内置工具。请使用你信任的本机程序。

格式化可以撤销。语法错误、工具缺失或工具执行失败时，编辑内容会保留；格式化期间继续输入时，过期结果不会覆盖新输入。开启「保存时格式化」后，格式化失败会取消本次保存，可关闭该选项后保存原文。

## 文件、草稿与预览

文档不会上传服务器。应用不内置遥测、远程代码执行、依赖自动安装或自动更新。

保存使用同目录临时文件替换，并保留现有文件权限和 UTF-8 BOM。检测到磁盘文件被其他程序修改或删除时，需要明确选择是否覆盖。

草稿与编辑设置保存在：`~/Library/Application Support/Luma Editor/`。会话备份经过短暂延迟写入，可用于意外退出后恢复；它不替代 ⌘ S 保存。正常退出选择「不保存」会放弃该文档的未保存修改。重新启动时，已保存且无修改的标签重新读取磁盘，未保存草稿保留恢复内容。

Markdown 支持标题、表格、任务列表、代码块、引用和本地栅格图片。预览会过滤脚本及危险 HTML；本地图片必须位于 Markdown 文件同目录或其子目录中。远程图片不会自动下载，网页链接点击后由系统浏览器打开。当前不包含 Mermaid、数学公式或 Markdown 所见即所得富文本编辑。

当前边界：单个文本文件最多 **12 MB**，格式化输入最多 **10 MB**，最多同时打开 **50 个标签页**；格式化工具最长运行 **10 秒**。只接受有效 UTF-8（支持 BOM），其他编码应先转换。项目文件搜索最多扫描约 4,000 个目录项、12 层目录；跳过 `.git`、`node_modules` 和符号链接。

## 源码与构建

同目录提供 `Luma Editor 源码.zip`。解压后使用 Node.js 24 或更高版本：

```sh
npm ci
npm run build
npm start
```

`npm test` 执行格式化与存储测试。`node scripts/smoke.mjs` 用临时文件和隔离会话启动真正的 Electron 窗口，验证核心编辑流程；原生文件选择和确认框在自动化脚本中使用返回值替身。

`npm run package` 构建 macOS 应用并写到源码目录下的 `release/`。可通过 `LUMA_OUTPUT_DIR` 指定其他输出目录。所有依赖版本已锁定，应用运行时不加载项目中的可执行格式化配置文件。

主要开源组件：[Electron](https://www.electronjs.org/docs/latest/tutorial/security)、[Monaco Editor](https://github.com/microsoft/monaco-editor)、[Prettier](https://prettier.io/docs/plugins)、[Marked](https://marked.js.org/)、[DOMPurify](https://github.com/cure53/DOMPurify)。组件许可证随应用依赖或源码包附带的第三方说明一起提供。
