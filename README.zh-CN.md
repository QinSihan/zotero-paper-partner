<p align="center">
  <img src="./assets/image.png" alt="Zotero Paper Partner icon" width="120">
</p>

# Zotero Paper Partner

一个 Zotero 插件，能悄悄回答你在笔记里写下的 `Q:` 问题——在后台静默完成，不打断你的阅读。

![Zotero](https://img.shields.io/badge/Zotero-9-E05A47?logo=zotero&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=000)
![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI兼容-412991?logo=openai&logoColor=white)
![GitHub Downloads](https://img.shields.io/github/downloads/QinSihan/zotero-paper-partner/total?label=downloads&logo=GitHub)
![Open Prompt](https://img.shields.io/badge/Open%20Prompt-public-2C7A7B)
![Vibe Coding](https://img.shields.io/badge/Vibe%20Coding-Agent可复现-111111)

[English](./README.md)

[![Demo](./assets/demo.gif)](./assets/demo.mp4)

---

## The idea

本插件为了一个很具体的场景而生：你在读论文，突然有某句话/某个概念没太看懂，但又懒得切换注意力去一个别的窗口问 ai 再等它回答，打断你好不容易进入的阅读状态。

现在你不再需要开新的聊天窗口，不再需要复制粘贴上下文，也不需要离开阅读状态。你只需要在当前正在写的 Zotero note 里写一行 `Q:`，然后继续往下读。过一会儿，LLM 给的答案会回填在问题下面。

```
> The model uses a representation-agnostic objective.
Q: representation-agnostic 在这里是什么意思？

A[done]: 意思是该方法不依赖某种特定的内部表示，而是能在多种编码方式下通用。
```

专注很难，阅读很累，不要让去问ai这件事情继续增加阅读负担了。

## 特点

**即问即得** 不需要读完重新整理 ai 的回答做成 Q&A 笔记，引用、问题、回答都在一个普通的 Zotero note 里。可以完全融入你原来的笔记逻辑。

**润物无声** 插件会静默处理你的问题，不会干扰你的注意力。

**轻松复现** 实现非常轻量，仓库里不止有所有源码，还有 [`target.md`](./target.md)。里面是整个实现的设计思路和一些需要用到 Zotero 9 的特性，任何人都可以把这个 Markdown 交给市面上的任何 coding Agent 来实现 Agent 复现。

---

## 安装

在 GitHub Releases 里下载 `paper-partner.xpi`，然后在 Zotero 里：`工具 → 插件 → 从文件安装插件`。

## 配置

`Zotero 偏好设置 → Paper Partner` — 填入 API key、接口地址、模型名称、回答模式和触发延迟。默认使用 DeepSeek 的 OpenAI 兼容 API。

## Q&A

**支持哪些 API？**  
Paper Partner 调用 OpenAI-compatible Chat Completions 接口。默认配置是 DeepSeek；OpenAI、Kimi/Moonshot、阿里百炼 DashScope、SiliconFlow、OpenRouter 等服务通常也可以通过填写对应 endpoint 和 model 使用。Provider 预设还没有内置。

**API Endpoint 应该填什么？**  
这里需要填完整的 chat completions URL，例如 `https://api.deepseek.com/v1/chat/completions`。如果某个服务商文档只给了 `base_url`，里一般需要在后面补上 `/chat/completions`。

**Brief 和 Detailed 有什么区别？**  
Brief 适合不中断阅读流：只解释当前问到的术语或句子，回答会很简短。Detailed 会更充分解释概念、机制、因果关系，但仍不会总结整篇论文。

**Trigger Delay 是什么？**  
这是你按下回车新开一段后，插件等待多久才开始处理问题。Immediate 是 0 秒，Short 是 1 秒，Medium 是 2 秒，Long 是 3 秒。

**为什么会出现 `A[error]: ...`？**  
这说明插件收到了 API 错误、空回复，或者模型回答被 token limit 截断。可以删掉这行 `A[error]: ...`，然后稍稍修改问题或缩短上下文，再按 Enter 重新触发请求。

## 环境要求

Zotero 7+（在 Zotero 9 上测试通过）。支持任何 OpenAI 兼容的 API 接口。

---

## 一点说明

这个项目 99% 都是 vibe coding 做出来的。核心 prompt / spec 就公开放在 [`target.md`](./target.md) 里，所以不只是 open source，大概也算是 open prompt。
