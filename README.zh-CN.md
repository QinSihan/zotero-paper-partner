<p align="center">
  <img src="./assets/image.png" alt="Zotero Paper Partner icon" width="120">
</p>

# Zotero Paper Partner

一个 Zotero 插件，能悄悄回答你在笔记里写下的 `Q:` 问题——在后台静默完成，不打断你的阅读。

![Zotero](https://img.shields.io/badge/Zotero-7%E2%80%9310.0-E05A47?logo=zotero&logoColor=white)
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

`Zotero 偏好设置 → Paper Partner` — 选择服务商，填入 API Key、接口地址和模型名称，再按自己的习惯选择回答模式和触发延迟。默认使用 DeepSeek；不常用的选项收在 `Advanced` 里。

OrcaRouter 是可选项：选择后，填入你在 [官网](https://www.orcarouter.ai/)创建的 Key 即可。问题和附近笔记片段会经这个第三方网关发送给模型服务商，请避免敏感内容，并确认所选模型的价格；免费供应可能变化。[隐私及配置说明](./docs/API-COMPATIBILITY.md#privacy-and-orcarouter)。

## Q&A

**支持哪些 API？**  
支持 DeepSeek、OpenAI、Claude、Gemini 等常见文本 API，多数填写对应地址和模型就能使用。各家的配置示例和兼容范围见 [服务商配置指南](./docs/API-COMPATIBILITY.md)。

**API Endpoint 应该填什么？**  
填完整接口地址，例如 `https://api.deepseek.com/v1/chat/completions`，插件通常会自动识别格式。其他服务商的示例见 [配置指南](./docs/API-COMPATIBILITY.md)。

**Brief 和 Detailed 有什么区别？**  
Brief 适合不中断阅读流：只解释当前问到的术语或句子，回答会很简短。Detailed 会更充分解释概念、机制、因果关系，但仍不会总结整篇论文。

**Trigger Delay 是什么？**  
这是你按下回车新开一段后，插件等待多久才开始处理问题。Immediate 是 0 秒，Short 是 1 秒，Medium 是 2 秒，Long 是 3 秒。

**为什么会出现 `A[error]: ...`？**  
在插件设置中展开 **Trouble answering?**，可按错误类型查看 token 上限、超时和 API 凭据等问题的处理方法。解决后删掉 `A[error]: ...` 这行，修改问题，再按 Enter 重试。

## 环境要求

Zotero 7.0–10.0.x，以及所选服务商的 API Key。[兼容说明](./docs/API-COMPATIBILITY.md#validation-and-release)。

---

## 一点说明

这个项目 99% 都是 vibe coding 做出来的。核心 prompt / spec 就公开放在 [`target.md`](./target.md) 里，所以不只是 open source，大概也算是 open prompt。
