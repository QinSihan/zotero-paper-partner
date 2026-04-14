# Zotero 异步问答插件：开工说明

## 版本信息

zotero版本："9.0"

## 你的核心目标

我要做的不是一个聊天助手，也不是一个功能很重的 AI 阅读器，而是一个**尽量不打断阅读流的异步问答补全工具**。

用户在 Zotero 里读论文时，会在 note 里记下暂时没看懂的问题。理想体验是：

- 用户只需要写一个以 `Q:` 开头的问题
- 然后继续往下读，不需要停下来等待回答
- 系统在后台静默处理
- 过一会儿把一个**很短的回答**自动写回到该问题下面
- 全过程不要弹窗、不要提示、不要抢焦点、不要把用户拖入聊天交互

这个 MVP 的第一优先级不是“聪明”，而是：

- **低打断**
- **可预测**
- **行为克制**
- **实现稳定**

---

## 我明确不要的东西

这一版先不要做：

- 多轮对话
- 持续追问
- 聊天面板式体验
- 全文 RAG
- 默认联网搜索
- 高亮颜色触发
- 复杂 UI
- 自动重试
- 很智能但不稳定的推断逻辑

换句话说，这不是一个“会主动跟用户互动的 agent”，而是一个**安静的后台补全器**。

---

## 用户侧交互应该非常简单

### 用户只做一件事
在 note 里写：

```text
Q: 这里的 representation-agnostic 是什么意思？
```

### 系统自动做后续事情
系统发现这个问题后，自动在下面维护回答状态，例如：

```text
A[running]:
A[done]: ...
A[stale]:
A[error]:
```

用户不需要手写这些状态。

---

## 问题识别规则（先严格）

这一版先刻意做得严格一点，避免误触发。

只把下面这种段落当成问题：

- 段落以 `Q` 开头
- 问题完整写在一个段落里

假设不存在其他写法，只有Q。

这样做的原因很简单：  
MVP 阶段先保证稳定和可控，后续如果效果好，再放宽语法。

---

## 我希望系统如何理解“这个问题对应什么上下文”

不要做复杂语义匹配，也不要试图推断问题对应的是哪一个具体高亮。

先用一个非常朴素、但很稳的规则：

- 只有 `Q:` 和 `A[...]` 这种段落算边界
- 对于某个 `Q:`，向上读，直到最近一个 `Q:` 或 `A[...]`
- 这中间所有内容，都算这个 `Q` 的局部上下文（domain）

也就是说：

- 不区分引用段、备注段、导入注释段
- 不做复杂分类
- 只用一个简单规则：**Q/A 是边界，其他内容都属于某个问题的域**

如果这个 `Q:` 上方没有任何内容，那就把它当作一个没有局部上下文的概念性问题处理。

---

## 我希望系统如何判断“这个问题还没有被处理”

也用一个简单规则：

- 对某个 `Q:`，向后看
- 直到下一个 `Q:` 或 note 结束
- 如果这中间没有任何 `A[...]`
- 那它就是一个待处理问题

如果已经有：

- `A[running]`
- `A[done]`
- `A[stale]`
- `A[error]`

那就认为这个问题已经进入对应状态，不要重复建任务。

---

## 触发方式的意图

我不希望系统靠粗暴轮询去扫整个库。  
我更希望它只在**某个 note 真的被修改之后**再处理，而且要有一点延迟，避免用户刚写完问题时系统立刻动笔记。

理想行为是：

- note 被修改
- 等用户停手 3 秒（debounce）
- 再只扫描这个 note
- 找到还没回答的问题
- 静默进入处理流程

触发保护规则：

- **Q: 必须不是 note 的最后一段才会被处理**
- 用户写完 Q 后按 Enter 开启新段落，这个动作自然地作为”问题已完成”的信号
- 这样解决了输入法（IME）场景下字符还在 buffer 里、5 秒 debounce 提前触发的问题

重点是：

- **不要打扰**
- **不要全局轮询**
- **不要处理无关 note**

实现方式：

- Zotero 通过 `Zotero.Notifier` 提供 item 事件，监听 `item.modify` 实现类中断的效果

---

## 为什么需要一致性校验

这个点很重要。

如果用户在回答生成过程中，修改了：

- `Q:` 本身
- 或者 `Q:` 上方那段局部上下文

那旧答案就可能已经不适用了。

所以我不希望系统只盯着问题文本。  
我希望它至少同时关注两件事：

- 问题本身有没有变
- 这个问题所属的局部域有没有变

如果变了，就不要把旧结果硬写回去。  
这种情况直接标成 `A[stale]:` 就够了。

MVP 不需要复杂冲突处理，但至少不能把过期答案写回去。

---

## 我对回答内容的要求

回答一定要短，而且要贴着局部问题来答。

### 我想要的回答
- 1–3 句
- 一个短段落
- 解释“这句话/这个术语在这里是什么意思”
- 尽量局部化
- 能帮我继续往下读

### 我不想要的回答
- 教科书式长篇解释
- related work 扩展
- 全文总结
- 大段引文
- 聊天腔或过度热情的语气

一句话概括：

> 这不是教学机器人，而是一个低打断的局部澄清器。

---

## 插件实现的边界

MVP 的实现方式：插件直接调用 OpenAI 兼容的 API（默认 DeepSeek），不依赖外部 worker 进程。

插件负责：

- 监听 note 变化
- 解析 note，找到待处理 Q
- 维护 `A[...]` 状态
- 直接调用 API 获取回答
- 把回答写回 note

API 配置（key / endpoint / model）通过 Zotero 首选项面板设置，运行时读取，不硬编码。

后续如需接入本地模型或更复杂的 tool call 能力，可改为调用独立 worker 进程，但 MVP 不需要。

---

## 总体实现风格

请优先按下面这个风格做：

- 行为克制
- 规则简单
- 状态清晰
- 便于调试
- 优先静默
- 不搞复杂智能推断

请不要一开始就追求“自动理解各种自由写法”“自动推断高亮语义”“自动检索整篇论文”这类扩展能力。

MVP 只需要把最基本闭环做稳：

1. 用户写 `Q:`
2. 系统发现它
3. 系统静默处理
4. 系统把短答写回原地

做到这一点，这个原型就是成功的。

---

## 总结

这版 MVP 的本质不是”做一个更聪明的 AI 助手”，而是：

**做一个不打断阅读注意力的、局部的、异步的 note 问题补全器。**

---

## 附录：供从零实现的 Agent 直接使用的 Zotero 9 开发参考

本附录的目的很具体：

- 帮助一个**从头开始实现本插件的 agent**
- 在**尽量不重新联网搜索**的前提下
- 直接掌握当前实现里已经验证过的 Zotero 9 特性、约束、接口写法和已知坑点

换句话说，这一节不是产品需求，而是一个本地开发参考。

它记录的是：

- 在实际开发和调试过程中确认有效的接口规范
- 当前 Zotero 9 环境下，做出这个 MVP 时真正需要知道的实现细节
- 哪些写法是可靠的，哪些地方容易踩坑

目标读者：

- 想基于本 md 自己从头实现一个类似 MVP 的开发者
- 想让 coding agent 直接读取本文件后开工的人

如果一个 agent 已经读完前面的产品目标部分，那么这里应该被当作“无需额外联网检索即可开工的实现附录”来使用。

---

### 0. 本项目现有代码说明

如果不是从零开始，而是基于本仓库当前版本继续做，那么先看这一节。

本仓库已包含一个可直接安装的 MVP 实现：

```
manifest.json     ← 插件元数据
bootstrap.js      ← 全部插件逻辑（解析、队列、API 调用、写回）
prefs.xhtml       ← 设置面板（API Key / Endpoint / Model）
paper-partner.xpi ← 打包好的安装包，直接拖入 Zotero 即可
```

**快速开始**：
1. Zotero → 工具 → 插件 → 齿轮 → 从文件安装附加组件，选 `paper-partner.xpi`
2. 工具 → 首选项 → Paper Partner，填入 API Key
3. 在任意文献的 note 里写 `Q: 你的问题`，按 Enter 换段，等 3 秒

如需修改后重新打包：
```bash
zip -j paper-partner.xpi manifest.json bootstrap.js prefs.xhtml
```

---

### 1. 插件文件结构（自己从头做的话）

如果要从空目录重新实现，一个最小可工作的目录结构如下。

```
my-plugin/
  manifest.json     ← 插件元数据（必须）
  bootstrap.js      ← 插件逻辑入口（必须）
  prefs.xhtml       ← 设置面板（可选，JS 内联在 onload 里，不需要单独 .js 文件）
```

打包：
```bash
zip -j my-plugin.xpi manifest.json bootstrap.js prefs.xhtml
```

---

### 2. manifest.json 格式

这一节给出 Zotero 9 下当前可工作的 manifest 约束。

Zotero 9 使用 WebExtension 风格的 manifest（version 2）。  
以下字段均为**必填**，缺任何一个都会导致安装失败或加载报错：

```json
{
    “manifest_version”: 2,
    “name”: “My Plugin”,
    “version”: “0.1.0”,
    “description”: “Description here.”,
    “author”: “your name”,
    “applications”: {
        “zotero”: {
            “id”: “my-plugin@your.domain”,
            “update_url”: “https://example.com/updates.json”,
            “strict_min_version”: “7.0”,
            “strict_max_version”: “9.*”
        }
    }
}
```

几个坑：

- `update_url` 必须是非空字符串，填一个占位 URL 即可，Zotero 只在检查更新时才真正请求它
- `strict_min_version` 用 `”7.0”` 而不是 `”7.0.0”`（三段式会被拒绝）
- `strict_max_version` 用 `”9.*”`，不能用 `”*”`（通配符不被接受）
- `author` 不能省略

---

### 3. bootstrap.js 生命周期

这一节说明 bootstrap 入口文件必须暴露的生命周期函数。

Zotero 启动/关闭时调用以下四个函数，必须在文件顶层定义：

```javascript
function install(data, reason) {}   // 首次安装时调用一次

function startup(data, reason) {
    // data.rootURI = 插件根目录 URI（如 file:///path/to/plugin/）
    // 必须等 Zotero 初始化完成再执行逻辑
    Zotero.initializationPromise.then(() => {
        // 在这里注册 Notifier、注册设置面板等
    });
}

function shutdown(data, reason) {
    // 清理：注销 Notifier、清空队列等
}

function uninstall(data, reason) {}  // 卸载时调用一次
```

---

### 4. 监听 Note 变化（Notifier）

这一节说明如何只在 note 真正发生修改时触发处理逻辑，而不是全局轮询。

Zotero 用事件系统通知各种变化，note 修改属于 `item.modify` 事件：

```javascript
// 注册观察者
const observerID = Zotero.Notifier.registerObserver(
    {
        notify(event, type, ids, extraData) {
            if (type !== “item” || event !== “modify”) return;
            for (const id of ids) {
                const item = Zotero.Items.get(id);
                if (item && item.isNote()) {
                    // 处理被修改的 note
                }
            }
        },
    },
    [“item”],          // 只监听 item 类型的事件
    “my-plugin”        // 观察者标识符，任意字符串
);

// 注销（在 shutdown 里调用）
Zotero.Notifier.unregisterObserver(observerID);
```

注意：插件自己写回 note（`item.saveTx()`）也会触发 modify 事件，需要自行防止循环处理（最简单的方式：写回后重新解析，发现没有未处理的 Q 就退出）。

---

### 5. 读写 Note 内容

这一节说明 note 在 Zotero 中的真实存储形式，以及安全的读写方式。

Note 以 HTML 字符串形式存储，通常是 `<div data-schema-version=”8”><p>...</p></div>` 结构。

```javascript
// 读取
const html = item.getNote();   // 返回 HTML 字符串

// 解析（DOMParser 在 bootstrap 上下文中可直接使用）
const doc = new DOMParser().parseFromString(html, “text/html”);
const paragraphs = doc.querySelectorAll(“p”);

// 修改后写回
item.setNote(doc.body.innerHTML);
await item.saveTx();           // 必须 await，写入数据库
```

---

### 6. 用户设置面板（PreferencePanes）

这一节非常关键，因为这里是 Zotero 9 中最容易踩坑、也最容易让 agent 误判的部分之一。

#### 正确做法：所有逻辑内联在 prefs.xhtml 的 onload 里

经过反复测试，以下方案在 Zotero 9 中唯一可靠：

- `src` 用 `rootURI + “prefs.xhtml”`（file:// URI，可以正常加载）
- **不使用 `scripts` 数组**：用 file:// 的脚本不会可靠执行；用 chrome:// 需要 chrome 注册，但 Zotero 9 里动态 chrome 注册（`aomStartup.registerChrome()`）实测不工作
- **把所有 JS 直接内联在 `onload` 属性里**，完全自包含，无外部依赖

#### bootstrap.js 注册方式

```javascript
// PreferencePanes.register 必须单独包在 try/catch 里
// 若它抛错而未捕获，会导致后续代码（如注册 Notifier）全部不执行
try {
    Zotero.PreferencePanes.register({
        pluginID: “my-plugin@your.domain”,
        src:      rootURI + “prefs.xhtml”,   // 不加 scripts 数组
        label:    “My Plugin”,
    });
} catch (e) {
    Zotero.debug(“[MyPlugin] PreferencePanes.register failed: “ + e.message);
}

// shutdown 里注销
try { Zotero.PreferencePanes.unregister(“my-plugin@your.domain”); } catch (_) {}
```

#### prefs.xhtml 格式

XHTML fragment（无 DOCTYPE，无 `<html>` 根元素），默认命名空间 XUL，HTML 元素加 `html:` 前缀。

所有逻辑写在根元素的 `onload` 属性里。注意：XML 属性里 `&&` 必须写成 `&amp;&amp;`（IDE 会报 JS 语法错，但这是 XML 的正确转义，运行时没问题）。

```xml
<groupbox xmlns:html=”http://www.w3.org/1999/xhtml” onload=”(function(){
  var PREFIX = 'extensions.my-plugin.';
  var DEFAULTS = { apiKey: '', apiEndpoint: 'https://...', model: 'my-model' };
  Object.keys(DEFAULTS).forEach(function(key) {
    var el = document.getElementById('my-' + key);
    if (!el) return;
    try {
      var v = Zotero.Prefs.get(PREFIX + key, true);
      el.value = (v !== undefined &amp;&amp; v !== null) ? v : DEFAULTS[key];
    } catch(e) { el.value = DEFAULTS[key]; }
    el.addEventListener('input', function() {
      Zotero.Prefs.set(PREFIX + key, el.value, true);
    });
  });
})()”>
  <label><html:h2>My Plugin</html:h2></label>
  <hbox align=”center”>
    <label value=”API Key” style=”min-width: 100px”/>
    <html:input type=”password” id=”my-apiKey” flex=”1”/>
  </hbox>
</groupbox>
```

关键点：
- 用 `input` 事件，不用 `change`（XUL 嵌套 HTML input 里 `change` 不可靠）
- `onload` 在面板展示时触发，此时 DOM 已就绪，`document.getElementById` 可正常使用
- `Zotero` 在设置窗口上下文里是全局可访问的

#### 读写 Preferences

```javascript
// 读取（第二个参数 true = 不存在时返回 undefined 而非抛异常）
const val = Zotero.Prefs.get(“extensions.my-plugin.someKey”, true);

// 写入
Zotero.Prefs.set(“extensions.my-plugin.someKey”, “value”, true);
```

---

### 7. 网络请求

这一节说明 bootstrap 上下文里能否直接访问外部 API。

`fetch()` 在 bootstrap 上下文中可直接使用，支持向外部 API 发请求：

```javascript
const response = await fetch(“https://api.example.com/v1/chat/completions”, {
    method: “POST”,
    headers: {
        “Content-Type”: “application/json”,
        “Authorization”: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: “...”, messages: [...] }),
});
const data = await response.json();
```

---

### 8. 调试方法

这一节给出本地调试时最实用的入口。

- 安装：工具 → 插件 → 右上角齿轮 → 从文件安装附加组件，选 `.xpi`
- 日志：工具 → 开发者 → Error Console，在搜索框输入插件前缀（如 `[MyPlugin]`）过滤
- 日志输出：`Zotero.debug(“[MyPlugin] some message”)`
- 其他 Zotero 自身的 warning（locale 缺失、DevTools Actor 等）可忽略，不影响插件运行
