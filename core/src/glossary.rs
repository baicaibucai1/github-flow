//! 本地翻译词典与规则。
//!
//! 这不是机器翻译：它不猜、不润色、不重写句子。它只做一件事——
//! 按最长匹配把英文技术词换成中文，把没把握的词原样留下。
//!
//! 为什么不用模型：模型会把 `win` 译成「胜利」、把 `branch` 译成「树枝」，
//! 因为它不知道这里在讲 Git。词典知道。技术文本的词汇量其实很小，
//! 一份精确的术语表比一个 400MB 的小模型更可靠，还快三个数量级。
//!
//! 译文风格是「技术直译」：读起来生硬，但每个词都译对了，
//! 程序员扫一眼就懂。要通顺是另一件事，那该调云端，不该改这本词典。

use std::collections::HashMap;
use std::sync::OnceLock;

/// 多词短语，最长匹配优先。放的都是「整体意思不等于逐词相加」的组合，
/// 或者逐词翻会走味的搭配。
pub const PHRASES: &[(&str, &str)] = &[
    // Git / GitHub
    ("pull request", "拉取请求"),
    ("merge request", "合并请求"),
    ("breaking change", "破坏性变更"),
    ("breaking changes", "破坏性变更"),
    ("backward compatible", "向后兼容"),
    ("backwards compatible", "向后兼容"),
    ("backward compatibility", "向后兼容"),
    ("release notes", "发布说明"),
    ("release note", "发布说明"),
    ("code of conduct", "行为准则"),
    ("issue tracker", "议题跟踪器"),
    ("version control", "版本控制"),
    ("source code", "源代码"),
    ("open source", "开源"),
    ("open-source", "开源"),
    ("free and open source", "免费开源"),
    ("unit test", "单元测试"),
    ("unit tests", "单元测试"),
    ("test coverage", "测试覆盖率"),
    ("continuous integration", "持续集成"),
    ("continuous delivery", "持续交付"),
    ("continuous deployment", "持续部署"),
    ("command line", "命令行"),
    ("command-line", "命令行"),
    ("getting started", "快速开始"),
    ("quick start", "快速开始"),
    ("quickstart", "快速开始"),
    ("read me", "说明文档"),
    ("issue template", "议题模板"),
    ("pull requests", "拉取请求"),
    ("merge conflicts", "合并冲突"),
    ("merge conflict", "合并冲突"),
    ("default branch", "默认分支"),
    ("main branch", "主分支"),
    ("feature branch", "功能分支"),
    ("working tree", "工作树"),
    ("working directory", "工作目录"),
    ("staged changes", "暂存的改动"),
    ("uncommitted changes", "未提交的改动"),
    ("remote repository", "远程仓库"),
    ("local repository", "本地仓库"),
    ("git history", "Git 历史"),
    ("git hooks", "Git 钩子"),

    // 编程通用
    ("design pattern", "设计模式"),
    ("design patterns", "设计模式"),
    ("use case", "使用场景"),
    ("use cases", "使用场景"),
    ("edge case", "边界情况"),
    ("edge cases", "边界情况"),
    ("real time", "实时"),
    ("real-time", "实时"),
    ("high performance", "高性能"),
    ("high-performance", "高性能"),
    ("low latency", "低延迟"),
    ("cross platform", "跨平台"),
    ("cross-platform", "跨平台"),
    ("full stack", "全栈"),
    ("full-stack", "全栈"),
    ("third party", "第三方"),
    ("third-party", "第三方"),
    ("out of the box", "开箱即用"),
    ("out-of-the-box", "开箱即用"),
    ("plug and play", "即插即用"),
    ("end to end", "端到端"),
    ("end-to-end", "端到端"),
    ("point to point", "点对点"),
    ("machine learning", "机器学习"),
    ("deep learning", "深度学习"),
    ("neural network", "神经网络"),
    ("neural networks", "神经网络"),
    ("natural language", "自然语言"),
    ("computer vision", "计算机视觉"),
    ("large language model", "大语言模型"),
    ("language model", "语言模型"),
    ("training data", "训练数据"),
    ("data set", "数据集"),
    ("data structure", "数据结构"),
    ("data structures", "数据结构"),
    ("state machine", "状态机"),
    ("memory leak", "内存泄漏"),
    ("race condition", "竞态条件"),
    ("dead lock", "死锁"),
    ("buffer overflow", "缓冲区溢出"),
    ("type safety", "类型安全"),
    ("type system", "类型系统"),
    ("garbage collection", "垃圾回收"),
    ("reference counting", "引用计数"),
    ("lifetime", "生命周期"),
    ("error handling", "错误处理"),
    ("exception handling", "异常处理"),
    ("dependency injection", "依赖注入"),
    ("in memory", "内存中"),
    ("in-memory", "内存中"),
    ("on disk", "磁盘上"),
    ("on the fly", "即时"),
    ("under the hood", "底层"),
    ("up to date", "最新"),
    ("up-to-date", "最新"),
    ("a set of", "一组"),
    ("a list of", "一组"),
    ("a range of", "一系列"),
    // ── 第三批：拿 description + readme_head 全量跑频次统计补的 ──
    ("play", "播放"),
    ("foundation", "基金会"),
    ("mod", "模组"),
    ("compositor", "合成器"),
    ("star", "星标"),
    ("fun", "乐趣"),
    ("little", "少量"),
    ("box", "盒子"),
    ("refer", "参考"),
    ("refers", "参考"),
    ("refer to", "参见"),
    ("equip", "装备"),
    ("unlock", "解锁"),
    ("untapped", "未开发"),
    ("supercharge", "增强"),
    ("human-like", "类人"),
    ("allow", "允许"),
    ("allows", "允许"),
    ("allowing", "允许"),
    ("supercharged", "增强"),
    ("empowering", "赋能"),
    ("empower", "赋能"),
    ("enables", "使能"),
    ("enable", "启用"),
    ("housed", "存放"),
    ("ad blocker", "广告拦截器"),
    ("blocker", "拦截器"),
    ("lobster", "龙虾"),
    ("guidelines", "指南"),
    ("guideline", "指南"),
    ("employ", "聘请"),
    ("employs", "聘请"),
    ("donor", "捐赠者"),
    ("donors", "捐赠者"),
    ("direct", "直接"),
    ("ultra-lightweight", "超轻量"),
    ("lightweight", "轻量"),
    ("remember", "记住"),
    ("supply", "提供"),
    ("work with", "处理"),
    ("stay in the loop", "保持了解"),
    ("on top of", "掌握"),
    ("shape", "塑造"),
    ("decide", "决定"),
    ("cannot", "不会"),
    ("to be used as", "用作"),
    ("used as", "用作"),
    ("please", "请"),
    ("instructions", "说明"),
    ("versatile", "多用途"),
    ("major", "主要"),
    ("inside", "内部"),
    ("existing", "现有"),
    ("flow", "流程"),
    ("functionality", "功能"),
    ("ships", "随附"),
    ("formerly", "原名"),
    ("standalone", "独立"),
    ("youre", "你是"),
    ("whole", "整个"),
    ("almost", "几乎"),
    ("additional", "额外"),
    ("executable", "可执行文件"),
    ("variety", "多种"),
    ("known", "已知"),
    ("easier", "更容易"),
    ("found", "发现"),
    ("base", "基础"),
    ("low", "低"),
    ("actually", "实际上"),
    ("dont", "不"),
    ("progress", "进度"),
    ("related", "相关"),
    ("series", "系列"),
    ("short", "简短"),
    ("behind", "背后"),
    ("primary", "主要"),
    ("aka", "又称"),
    ("generative", "生成式"),
    ("welcome", "欢迎"),
    ("streamline", "简化"),
    ("independent", "独立"),
    ("minutes", "分钟"),
    ("pronounced", "发音"),
    ("accurate", "准确"),
    ("interact", "交互"),
    ("family", "系列"),
    ("manga", "漫画"),
    ("structure", "结构"),
    ("stays", "保持"),
    ("stay", "保持"),
    ("target", "目标"),
    ("course", "课程"),
    ("self-contained", "自包含"),
    ("browse", "浏览"),
    ("dark", "深色"),
    ("light", "浅色"),
    ("perform", "执行"),
    ("ever", "曾经"),
    ("helper", "辅助"),
    ("action", "动作"),
    ("type-safe", "类型安全"),
    ("communication", "通信"),
    ("trust", "信任"),
    ("ship", "发布"),
    ("computation", "计算"),
    ("forever", "永久"),
    ("millions", "数百万"),
    ("beyond", "超出"),
    ("fill", "填充"),
    ("high-quality", "高质量"),
    ("future", "未来"),
    ("wide", "广泛"),
    ("commercial", "商业"),
    ("overlay", "浮层"),
    ("prototyping", "原型"),
    ("consistent", "一致"),
    ("motion", "动效"),
    ("analyzer", "分析器"),
    ("extraction", "提取"),
    ("takes", "需要"),
    ("take", "需要"),
    ("intended", "旨在"),
    ("higher", "更高"),
    ("filesystem", "文件系统"),
    ("messenger", "通讯工具"),
    ("rewrite", "重写"),
    ("statistics", "统计"),
    ("love", "喜爱"),
    ("maintenance", "维护"),
    ("companion", "伴侣"),
    ("choice", "选择"),
    ("principles", "原则"),
    ("effects", "效果"),
    ("graphical", "图形"),
    ("continuous", "持续"),
    ("confidence", "信心"),
    ("friends", "朋友"),
    ("seconds", "秒"),
    ("metadata", "元数据"),
    ("efficiency", "效率"),
    ("itself", "自身"),
    ("readable", "可读"),
    ("production-grade", "生产级"),
    ("reach", "触达"),
    ("serialization", "序列化"),
    ("anyone", "任何人"),
    ("tabs", "标签页"),
    ("auto-updated", "自动更新"),
    ("stale", "过期"),
    ("talk", "通信"),
    ("symbols", "符号"),
    ("indexes", "索引"),
    ("refreshing", "清新"),
    ("one of the commands below", "以下命令之一"),
    ("one of the following", "以下之一"),
    ("commands below", "以下命令"),
    ("command below", "以下命令"),
    ("following commands", "以下命令"),
    ("following command", "以下命令"),
    ("a number of", "若干"),
    ("a lot of", "大量"),
    ("lots of", "大量"),
    ("plenty of", "大量"),
    ("kind of", "一种"),
    ("type of", "一种"),
    ("types of", "多种"),
    ("instead of", "而不是"),
    ("because of", "由于"),
    ("in terms of", "关于"),
    ("as well as", "以及"),
    ("such as", "例如"),
    ("for example", "例如"),
    ("for instance", "例如"),
    ("in order to", "为了"),
    ("in addition", "此外"),
    ("as a result", "因此"),
    ("by default", "默认"),
    ("in fact", "实际上"),
    ("at least", "至少"),
    ("at most", "最多"),
    ("more than", "超过"),
    ("less than", "少于"),
    ("no longer", "不再"),
    ("as soon as", "一旦"),
    ("as long as", "只要"),
    ("even if", "即使"),
    ("as if", "仿佛"),
    ("make sure", "确保"),
    ("make it easy", "便于"),
    ("makes it easy", "便于"),
    ("get started", "开始使用"),
    ("set up", "设置"),
    ("set-up", "设置"),
    ("plug in", "接入"),
    ("log in", "登录"),
    ("log out", "登出"),
    ("sign in", "登录"),
    ("sign up", "注册"),
    ("sign out", "登出"),
    ("roll back", "回滚"),
    ("roll out", "推出"),
    ("opt in", "选择加入"),
    ("opt out", "选择退出"),
    ("built with", "基于"),
    ("built on", "基于"),
    ("built in", "内置"),
    ("built-in", "内置"),
    ("based on", "基于"),
    ("powered by", "由"),
    ("written in", "编写于"),
    ("designed for", "面向"),
    ("used for", "用于"),
    ("used to", "用于"),
    ("used by", "被使用于"),
    ("works with", "兼容"),
    ("work with", "兼容"),
    ("compatible with", "兼容"),
    ("support for", "支持"),
    ("supports for", "支持"),
    ("thanks to", "得益于"),
    ("due to", "由于"),
    ("according to", "根据"),
    ("related to", "相关于"),
    ("similar to", "类似于"),
    ("compared to", "相比"),
    ("along with", "连同"),
    ("together with", "连同"),
    ("as part of", "作为"),
    ("in front of", "在之前"),
    ("on top of", "基于"),
    ("free of charge", "免费"),
    ("for free", "免费"),
    ("open to", "面向"),
    ("ready to use", "开箱即用"),
    ("easy to use", "易于使用"),
    ("simple to use", "易于使用"),
    ("hard to", "难以"),
    ("easy to", "易于"),

    // 平台 / 系统
    ("operating system", "操作系统"),
    ("operating systems", "操作系统"),
    ("virtual machine", "虚拟机"),
    ("virtual machines", "虚拟机"),
    ("file system", "文件系统"),
    ("file systems", "文件系统"),
    ("root directory", "根目录"),
    ("home directory", "主目录"),
    ("working folder", "工作文件夹"),
    ("environment variable", "环境变量"),
    ("environment variables", "环境变量"),
    ("path variable", "路径变量"),
    ("package manager", "包管理器"),
    ("package managers", "包管理器"),
    ("web server", "Web 服务器"),
    ("web servers", "Web 服务器"),
    ("web site", "网站"),
    ("web app", "Web 应用"),
    ("web application", "Web 应用"),
    ("web applications", "Web 应用"),
    ("desktop app", "桌面应用"),
    ("desktop application", "桌面应用"),
    ("mobile app", "移动应用"),
    ("mobile application", "移动应用"),
    ("single page", "单页"),
    ("single-page", "单页"),
    ("server side", "服务端"),
    ("server-side", "服务端"),
    ("client side", "客户端"),
    ("client-side", "客户端"),
    ("front end", "前端"),
    ("front-end", "前端"),
    ("back end", "后端"),
    ("back-end", "后端"),
    ("user interface", "用户界面"),
    ("user experience", "用户体验"),
    ("user name", "用户名"),
    ("user name", "用户名"),
    ("access token", "访问令牌"),
    ("api key", "API 密钥"),
    ("private key", "私钥"),
    ("public key", "公钥"),
    ("pull down", "下拉"),
    ("push up", "推上"),
    ("hot reload", "热重载"),
    ("hot reloading", "热重载"),
    ("hot module", "热模块"),
    ("tree shaking", "摇树优化"),
    ("code splitting", "代码分割"),
    ("lazy loading", "懒加载"),
    ("load balancer", "负载均衡器"),
    ("load balancing", "负载均衡"),
    ("rate limit", "速率限制"),
    ("rate limiting", "速率限制"),
    ("access control", "访问控制"),
    ("single sign", "单点登录"),
    ("two factor", "双因素"),
    ("two-factor", "双因素"),
    ("end point", "端点"),
    ("end points", "端点"),
    ("api endpoint", "API 端点"),
    ("status code", "状态码"),
    ("error code", "错误码"),
    ("response body", "响应体"),
    ("request body", "请求体"),
    ("query string", "查询字符串"),
    ("path parameter", "路径参数"),
    ("url parameter", "URL 参数"),

    // 语法连接词。这些不翻译就是半截白话，翻错了就是病句
    ("how to", "如何"),
    ("down to", "直到"),
    ("up to", "最多"),
    ("at once", "同时"),
    ("so that", "以便"),
    ("such that", "使得"),
    ("one of", "之一"),
    ("some of", "其中一些"),
    ("most of", "其中大多数"),
    ("part of", "一部分"),
    ("a variety of", "多种"),
    ("out of", "出于"),
    ("regardless of", "无论"),
    ("in spite of", "尽管"),
    ("the same", "相同"),
    ("per second", "每秒"),
    ("per minute", "每分钟"),
    ("per hour", "每小时"),
    ("per day", "每天"),

    // 不定式：`to + 动词` 译成「到」会变成「内容到帮助开发者」。
    // 挑出高频的几个给个「以…」的说法，句子立刻顺一截。
    ("to help", "以帮助"),
    ("to make", "使"),
    ("to use", "使用"),
    ("to build", "构建"),
    ("to create", "创建"),
    ("to get", "获取"),
    ("to run", "运行"),
    ("to see", "查看"),
    ("to learn", "学习"),
    ("to enable", "以启用"),
    ("to ensure", "以确保"),
    ("to avoid", "以避免"),
    ("to support", "以支持"),
    ("to provide", "以提供"),
    ("to allow", "以允许"),
    ("to improve", "以改进"),
    ("to reduce", "以减少"),
    ("to prevent", "以防止"),
    ("to detect", "以检测"),
    ("to handle", "以处理"),
    ("to keep", "以保持"),
    ("computer science", "计算机科学"),
    ("with support for", "支持"),
    ("with support", "支持"),
    ("support for", "支持"),
    ("works on", "适用于"),
    ("works with", "兼容"),
    ("runs on", "运行于"),
    ("built for", "面向"),
    ("made for", "面向"),
    ("made with", "基于"),
];

/// 单词表。**技术语境优先**——这是整本词典最重要的一条约定：
/// 同一个词在日常生活里的意思，在 GitHub 上几乎都不是那个意思。
/// `win` 是 Windows，不是胜利；`branch` 是分支，不是树枝；
/// `commit` 是提交，不是承诺；`fork` 是派生，不是叉子。
pub const WORDS: &[(&str, &str)] = &[
    // 平台与系统（歧义重灾区）
    ("win", "Windows"),
    ("windows", "Windows"),
    ("window", "窗口"),
    ("windowed", "窗口化"),
    ("linux", "Linux"),
    ("unix", "Unix"),
    ("macos", "macOS"),
    ("mac", "Mac"),
    ("osx", "OS X"),
    ("android", "Android"),
    ("ios", "iOS"),
    ("ubuntu", "Ubuntu"),
    ("debian", "Debian"),
    ("centos", "CentOS"),
    ("fedora", "Fedora"),
    ("arch", "Arch"),
    ("wsl", "WSL"),
    ("terminal", "终端"),
    ("console", "控制台"),
    ("shell", "终端"),
    ("bash", "Bash"),
    ("zsh", "zsh"),
    ("powershell", "PowerShell"),
    ("cmd", "cmd"),
    ("kernel", "内核"),
    ("driver", "驱动"),
    ("drivers", "驱动"),
    ("disk", "磁盘"),
    ("folder", "文件夹"),
    ("folders", "文件夹"),
    ("file", "文件"),
    ("files", "文件"),
    ("filename", "文件名"),
    ("filepath", "文件路径"),
    ("path", "路径"),
    ("paths", "路径"),
    ("root", "根目录"),
    ("home", "主目录"),
    ("mount", "挂载"),
    ("mounting", "挂载"),
    ("boot", "启动"),
    ("boots", "启动"),
    ("reboot", "重启"),
    ("shutdown", "关机"),
    ("startup", "启动"),
    ("process", "进程"),
    ("processes", "进程"),
    ("thread", "线程"),
    ("threads", "线程"),
    ("daemon", "守护进程"),
    ("service", "服务"),
    ("services", "服务"),
    ("background", "后台"),
    ("foreground", "前台"),

    // Git 概念
    ("repo", "仓库"),
    ("repos", "仓库"),
    ("repository", "仓库"),
    ("repositories", "仓库"),
    ("commit", "提交"),
    ("commits", "提交"),
    ("committed", "已提交"),
    ("branch", "分支"),
    ("branches", "分支"),
    ("merge", "合并"),
    ("merged", "已合并"),
    ("merging", "合并"),
    ("rebase", "变基"),
    ("fork", "派生"),
    ("forks", "派生"),
    ("forked", "已派生"),
    ("clone", "克隆"),
    ("cloned", "已克隆"),
    ("checkout", "检出"),
    ("stash", "贮藏"),
    ("revert", "回滚"),
    ("reset", "重置"),
    ("tag", "标签"),
    ("tags", "标签"),
    ("release", "发布"),
    ("releases", "发布"),
    ("issue", "议题"),
    ("issues", "议题"),
    ("ticket", "工单"),
    ("tickets", "工单"),
    ("pr", "PR"),
    ("prs", "PR"),
    ("diff", "差异"),
    ("diffs", "差异"),
    ("patch", "补丁"),
    ("patches", "补丁"),
    ("conflict", "冲突"),
    ("conflicts", "冲突"),
    ("remote", "远程"),
    ("upstream", "上游"),
    ("origin", "源"),
    ("submodule", "子模块"),
    ("submodules", "子模块"),
    ("monorepo", "单一仓库"),
    ("workflow", "工作流"),
    ("workflows", "工作流"),
    ("contributor", "贡献者"),
    ("contributors", "贡献者"),
    ("maintainer", "维护者"),
    ("maintainers", "维护者"),
    ("collaborator", "协作者"),
    ("reviewer", "审查者"),
    ("milestone", "里程碑"),
    ("changelog", "变更日志"),
    ("roadmap", "路线图"),

    // 代码与语言
    ("code", "代码"),
    ("codes", "代码"),
    ("coding", "编码"),
    ("source", "源代码"),
    ("library", "库"),
    ("libraries", "库"),
    ("lib", "库"),
    ("framework", "框架"),
    ("frameworks", "框架"),
    ("package", "包"),
    ("packages", "包"),
    ("module", "模块"),
    ("modules", "模块"),
    ("component", "组件"),
    ("components", "组件"),
    ("plugin", "插件"),
    ("plugins", "插件"),
    ("extension", "扩展"),
    ("extensions", "扩展"),
    ("addon", "附加组件"),
    ("adapter", "适配器"),
    ("wrapper", "包装器"),
    ("binding", "绑定"),
    ("bindings", "绑定"),
    ("function", "函数"),
    ("functions", "函数"),
    ("method", "方法"),
    ("methods", "方法"),
    ("class", "类"),
    ("classes", "类"),
    ("object", "对象"),
    ("objects", "对象"),
    ("interface", "接口"),
    ("interfaces", "接口"),
    ("type", "类型"),
    ("types", "类型"),
    ("variable", "变量"),
    ("variables", "变量"),
    ("constant", "常量"),
    ("constants", "常量"),
    ("parameter", "参数"),
    ("parameters", "参数"),
    ("argument", "参数"),
    ("arguments", "参数"),
    ("return", "返回"),
    ("returns", "返回"),
    ("returned", "返回"),
    ("value", "值"),
    ("values", "值"),
    ("array", "数组"),
    ("arrays", "数组"),
    ("list", "列表"),
    ("lists", "列表"),
    ("map", "映射"),
    ("maps", "映射"),
    ("set", "集合"),
    ("dict", "字典"),
    ("string", "字符串"),
    ("strings", "字符串"),
    ("integer", "整数"),
    ("boolean", "布尔值"),
    ("float", "浮点数"),
    ("null", "空值"),
    ("nil", "空值"),
    ("undefined", "未定义"),
    ("error", "错误"),
    ("errors", "错误"),
    ("exception", "异常"),
    ("exceptions", "异常"),
    ("bug", "缺陷"),
    ("bugs", "缺陷"),
    ("fix", "修复"),
    ("fixes", "修复"),
    ("fixed", "已修复"),
    ("feature", "功能"),
    ("features", "功能"),
    ("test", "测试"),
    ("tests", "测试"),
    ("testing", "测试"),
    ("coverage", "覆盖率"),
    ("build", "构建"),
    ("builds", "构建"),
    ("building", "构建"),
    ("compile", "编译"),
    ("compiled", "已编译"),
    ("compiler", "编译器"),
    ("runtime", "运行时"),
    ("dependency", "依赖"),
    ("dependencies", "依赖"),
    ("install", "安装"),
    ("installed", "已安装"),
    ("installing", "安装"),
    ("installation", "安装"),
    ("uninstall", "卸载"),
    ("update", "更新"),
    ("updates", "更新"),
    ("updated", "已更新"),
    ("upgrade", "升级"),
    ("upgraded", "已升级"),
    ("migrate", "迁移"),
    ("migration", "迁移"),
    ("migrations", "迁移"),
    ("deploy", "部署"),
    ("deployed", "已部署"),
    ("deployment", "部署"),
    ("config", "配置"),
    ("configs", "配置"),
    ("configuration", "配置"),
    ("configure", "配置"),
    ("configured", "已配置"),
    ("environment", "环境"),
    ("environments", "环境"),
    ("script", "脚本"),
    ("scripts", "脚本"),
    ("command", "命令"),
    ("commands", "命令"),
    ("argument", "参数"),
    ("flag", "标志"),
    ("flags", "标志"),
    ("option", "选项"),
    ("options", "选项"),
    ("cli", "命令行"),
    ("sdk", "SDK"),
    ("api", "API"),
    ("apis", "API"),
    ("endpoint", "端点"),
    ("endpoints", "端点"),
    ("request", "请求"),
    ("requests", "请求"),
    ("response", "响应"),
    ("responses", "响应"),
    ("server", "服务器"),
    ("servers", "服务器"),
    ("client", "客户端"),
    ("clients", "客户端"),
    ("database", "数据库"),
    ("databases", "数据库"),
    ("db", "数据库"),
    ("query", "查询"),
    ("queries", "查询"),
    ("cache", "缓存"),
    ("cached", "已缓存"),
    ("caching", "缓存"),
    ("session", "会话"),
    ("sessions", "会话"),
    ("token", "令牌"),
    ("tokens", "令牌"),
    ("auth", "认证"),
    ("authentication", "身份验证"),
    ("authorization", "授权"),
    ("permission", "权限"),
    ("permissions", "权限"),
    ("role", "角色"),
    ("roles", "角色"),
    ("user", "用户"),
    ("users", "用户"),
    ("admin", "管理员"),
    ("log", "日志"),
    ("logs", "日志"),
    ("logging", "日志"),
    ("debug", "调试"),
    ("debugging", "调试"),
    ("profile", "性能分析"),
    ("profiling", "性能分析"),
    ("benchmark", "基准测试"),
    ("benchmarks", "基准测试"),
    ("performance", "性能"),
    ("latency", "延迟"),
    ("throughput", "吞吐量"),
    ("memory", "内存"),
    ("storage", "存储"),
    ("stream", "流"),
    ("streams", "流"),
    ("buffer", "缓冲区"),
    ("queue", "队列"),
    ("stack", "栈"),
    ("heap", "堆"),
    ("pool", "池"),
    ("pipe", "管道"),
    ("socket", "套接字"),
    ("frame", "帧"),
    ("frames", "帧"),
    ("render", "渲染"),
    ("rendered", "已渲染"),
    ("rendering", "渲染"),
    ("parse", "解析"),
    ("parsed", "已解析"),
    ("parser", "解析器"),
    ("resolve", "解析"),
    ("resolver", "解析器"),
    ("bind", "绑定"),
    ("attach", "附加"),
    ("detach", "分离"),
    ("spawn", "派生"),
    ("hook", "钩子"),
    ("hooks", "钩子"),
    ("callback", "回调"),
    ("middleware", "中间件"),
    ("regex", "正则表达式"),
    ("syntax", "语法"),
    ("semantic", "语义"),
    ("refactor", "重构"),
    ("refactoring", "重构"),
    ("optimize", "优化"),
    ("optimized", "已优化"),
    ("optimization", "优化"),
    ("deprecated", "已弃用"),
    ("legacy", "遗留"),
    ("async", "异步"),
    ("sync", "同步"),
    ("concurrent", "并发"),
    ("parallel", "并行"),
    ("serial", "串行"),
    ("scalable", "可扩展"),
    ("scaling", "扩展"),
    ("scaffold", "脚手架"),

    // 网络与云
    ("web", "Web"),
    ("website", "网站"),
    ("websites", "网站"),
    ("webpage", "网页"),
    ("page", "页面"),
    ("pages", "页面"),
    ("site", "站点"),
    ("sites", "站点"),
    ("url", "URL"),
    ("urls", "URL"),
    ("uri", "URI"),
    ("http", "HTTP"),
    ("https", "HTTPS"),
    ("tcp", "TCP"),
    ("udp", "UDP"),
    ("ip", "IP"),
    ("dns", "DNS"),
    ("proxy", "代理"),
    ("gateway", "网关"),
    ("firewall", "防火墙"),
    ("port", "端口"),
    ("ports", "端口"),
    ("host", "主机"),
    ("hosts", "主机"),
    ("domain", "域名"),
    ("protocol", "协议"),
    ("header", "请求头"),
    ("headers", "请求头"),
    ("cookie", "Cookie"),
    ("cookies", "Cookie"),
    ("cors", "跨域"),
    ("ssl", "SSL"),
    ("tls", "TLS"),
    ("certificate", "证书"),
    ("encryption", "加密"),
    ("encrypted", "已加密"),
    ("hash", "哈希"),
    ("hashed", "已哈希"),
    ("salt", "盐值"),
    ("jwt", "JWT"),
    ("oauth", "OAuth"),
    ("cdn", "CDN"),
    ("cloud", "云"),
    ("aws", "AWS"),
    ("azure", "Azure"),
    ("gcp", "GCP"),
    ("docker", "Docker"),
    ("container", "容器"),
    ("containers", "容器"),
    ("image", "镜像"),
    ("images", "镜像"),
    ("kubernetes", "Kubernetes"),
    ("k8s", "K8s"),
    ("pod", "Pod"),
    ("cluster", "集群"),
    ("node", "节点"),
    ("nodes", "节点"),
    ("json", "JSON"),
    ("yaml", "YAML"),
    ("yml", "YAML"),
    ("xml", "XML"),
    ("html", "HTML"),
    ("css", "CSS"),
    ("csv", "CSV"),
    ("markdown", "Markdown"),
    ("base64", "Base64"),
    ("utf", "UTF"),
    ("rest", "REST"),
    ("graphql", "GraphQL"),
    ("grpc", "gRPC"),
    ("websocket", "WebSocket"),
    ("websockets", "WebSocket"),

    // 前端
    ("frontend", "前端"),
    ("backend", "后端"),
    ("ui", "界面"),
    ("ux", "体验"),
    ("design", "设计"),
    ("layout", "布局"),
    ("template", "模板"),
    ("templates", "模板"),
    ("theme", "主题"),
    ("themes", "主题"),
    ("style", "样式"),
    ("styles", "样式"),
    ("dom", "DOM"),
    ("router", "路由"),
    ("routing", "路由"),
    ("state", "状态"),
    ("states", "状态"),
    ("props", "属性"),
    ("hydration", "水合"),
    ("ssr", "服务端渲染"),
    ("ssg", "静态生成"),
    ("spa", "单页应用"),
    ("pwa", "PWA"),
    ("seo", "SEO"),

    // AI / 数据
    ("model", "模型"),
    ("models", "模型"),
    ("training", "训练"),
    ("trained", "已训练"),
    ("inference", "推理"),
    ("dataset", "数据集"),
    ("datasets", "数据集"),
    ("data", "数据"),
    ("embedding", "嵌入"),
    ("embeddings", "嵌入"),
    ("vector", "向量"),
    ("vectors", "向量"),
    ("prompt", "提示词"),
    ("prompts", "提示词"),
    ("agent", "智能体"),
    ("agents", "智能体"),
    ("llm", "大语言模型"),
    ("llms", "大语言模型"),
    ("gpu", "GPU"),
    ("cuda", "CUDA"),
    ("tensor", "张量"),
    ("layer", "层"),
    ("layers", "层"),
    ("attention", "注意力"),
    ("ocr", "OCR"),
    ("vision", "视觉"),
    ("speech", "语音"),
    ("rag", "RAG"),

    // 高频动词
    ("use", "使用"),
    ("uses", "使用"),
    ("used", "使用"),
    ("using", "使用"),
    ("make", "创建"),
    ("makes", "让"),
    ("made", "已完成"),
    ("create", "创建"),
    ("creates", "创建"),
    ("created", "已创建"),
    ("creating", "创建"),
    ("generate", "生成"),
    ("generates", "生成"),
    ("generated", "已生成"),
    ("provide", "提供"),
    ("provides", "提供"),
    ("provided", "提供"),
    ("support", "支持"),
    ("supports", "支持"),
    ("supported", "支持"),
    ("allow", "允许"),
    ("allows", "允许"),
    ("enable", "启用"),
    ("enables", "启用"),
    ("enabled", "已启用"),
    ("disable", "禁用"),
    ("disabled", "已禁用"),
    ("require", "需要"),
    ("requires", "需要"),
    ("required", "必需"),
    ("include", "包含"),
    ("includes", "包含"),
    ("included", "包含"),
    ("contain", "包含"),
    ("contains", "包含"),
    ("containing", "包含"),
    ("help", "帮助"),
    ("helps", "帮助"),
    ("helping", "帮助"),
    ("let", "让"),
    ("lets", "让"),
    ("keep", "保持"),
    ("keeps", "保持"),
    ("handle", "处理"),
    ("handles", "处理"),
    ("handling", "处理"),
    ("manage", "管理"),
    ("manages", "管理"),
    ("management", "管理"),
    ("run", "运行"),
    ("runs", "运行"),
    ("running", "运行"),
    ("start", "开始"),
    ("starts", "开始"),
    ("started", "已开始"),
    ("stop", "停止"),
    ("stops", "停止"),
    ("stopped", "已停止"),
    ("open", "打开"),
    ("opens", "打开"),
    ("opened", "已打开"),
    ("close", "关闭"),
    ("closed", "已关闭"),
    ("read", "读取"),
    ("reads", "读取"),
    ("write", "写入"),
    ("writes", "写入"),
    ("written", "编写"),
    ("load", "加载"),
    ("loads", "加载"),
    ("loaded", "已加载"),
    ("loading", "加载"),
    ("save", "保存"),
    ("saved", "已保存"),
    ("send", "发送"),
    ("sends", "发送"),
    ("sent", "已发送"),
    ("receive", "接收"),
    ("received", "已接收"),
    ("fetch", "获取"),
    ("fetches", "获取"),
    ("get", "获取"),
    ("gets", "获取"),
    ("set", "设置"),
    ("sets", "设置"),
    ("add", "添加"),
    ("adds", "添加"),
    ("added", "已添加"),
    ("remove", "移除"),
    ("removes", "移除"),
    ("removed", "已移除"),
    ("delete", "删除"),
    ("deletes", "删除"),
    ("deleted", "已删除"),
    ("insert", "插入"),
    ("replace", "替换"),
    ("replaced", "已替换"),
    ("move", "移动"),
    ("moved", "已移动"),
    ("copy", "复制"),
    ("copied", "已复制"),
    ("paste", "粘贴"),
    ("import", "导入"),
    ("imports", "导入"),
    ("imported", "已导入"),
    ("export", "导出"),
    ("exports", "导出"),
    ("exported", "已导出"),
    ("call", "调用"),
    ("calls", "调用"),
    ("called", "调用"),
    ("invoke", "调用"),
    ("execute", "执行"),
    ("executed", "已执行"),
    ("execution", "执行"),
    ("launch", "启动"),
    ("launched", "已启动"),
    ("trigger", "触发"),
    ("triggered", "已触发"),
    ("detect", "检测"),
    ("detects", "检测"),
    ("detected", "已检测"),
    ("check", "检查"),
    ("checks", "检查"),
    ("checked", "已检查"),
    ("verify", "验证"),
    ("verified", "已验证"),
    ("validate", "校验"),
    ("validated", "已校验"),
    ("validation", "校验"),
    ("ensure", "确保"),
    ("ensures", "确保"),
    ("avoid", "避免"),
    ("prevent", "防止"),
    ("prevents", "防止"),
    ("reduce", "减少"),
    ("improve", "改进"),
    ("improves", "改进"),
    ("increase", "提升"),
    ("extend", "扩展"),
    ("extends", "扩展"),
    ("extended", "已扩展"),
    ("implement", "实现"),
    ("implements", "实现"),
    ("implemented", "已实现"),
    ("implementation", "实现"),
    ("integrate", "集成"),
    ("integrated", "已集成"),
    ("integration", "集成"),
    ("integrations", "集成"),
    ("wrap", "封装"),
    ("wraps", "封装"),
    ("expose", "暴露"),
    ("exposes", "暴露"),
    ("track", "跟踪"),
    ("tracks", "跟踪"),
    ("monitor", "监控"),
    ("monitoring", "监控"),
    ("measure", "测量"),
    ("collect", "收集"),
    ("collects", "收集"),
    ("store", "存储"),
    ("stores", "存储"),
    ("stored", "已存储"),
    ("share", "共享"),
    ("shares", "共享"),
    ("split", "拆分"),
    ("join", "连接"),
    ("connect", "连接"),
    ("connects", "连接"),
    ("connected", "已连接"),
    ("connection", "连接"),
    ("disconnect", "断开"),
    ("sync", "同步"),
    ("upload", "上传"),
    ("download", "下载"),
    ("downloads", "下载"),
    ("publish", "发布"),
    ("published", "已发布"),
    ("submit", "提交"),
    ("submitted", "已提交"),
    ("apply", "应用"),
    ("applied", "已应用"),
    ("register", "注册"),
    ("registered", "已注册"),
    ("login", "登录"),
    ("logout", "登出"),
    ("explain", "解释"),
    ("explains", "解释"),
    ("describe", "描述"),
    ("describes", "描述"),
    ("define", "定义"),
    ("defines", "定义"),
    ("defined", "已定义"),
    ("declare", "声明"),
    ("declared", "已声明"),
    ("assign", "赋值"),
    ("compare", "比较"),
    ("match", "匹配"),
    ("matches", "匹配"),
    ("search", "搜索"),
    ("searches", "搜索"),
    ("filter", "筛选"),
    ("filters", "筛选"),
    ("sort", "排序"),
    ("sorted", "已排序"),
    ("group", "分组"),
    ("merge", "合并"),
    ("combine", "组合"),
    ("convert", "转换"),
    ("converted", "已转换"),
    ("transform", "转换"),
    ("translate", "翻译"),
    ("format", "格式化"),
    ("formatted", "已格式化"),
    ("encode", "编码"),
    ("decode", "解码"),
    ("encrypt", "加密"),
    ("decrypt", "解密"),
    ("sign", "签名"),
    ("signed", "已签名"),
    ("compress", "压缩"),
    ("extract", "提取"),
    ("inject", "注入"),
    ("mount", "挂载"),
    ("embed", "嵌入"),
    ("serve", "提供服务"),
    ("serves", "提供服务"),
    ("serve", "服务"),
    ("host", "托管"),
    ("scale", "扩展"),
    ("tune", "调优"),
    ("tuning", "调优"),
    ("bench", "基准"),
    ("debug", "调试"),
    ("trace", "追踪"),
    ("tracing", "追踪"),
    ("log", "记录"),
    ("emit", "发出"),
    ("listen", "监听"),
    ("wait", "等待"),
    ("retry", "重试"),
    ("fallback", "回退"),
    ("fallbacks", "回退"),

    // 高频名词
    ("app", "应用"),
    ("apps", "应用"),
    ("application", "应用"),
    ("applications", "应用"),
    ("project", "项目"),
    ("projects", "项目"),
    ("tool", "工具"),
    ("tools", "工具"),
    ("toolkit", "工具包"),
    ("utility", "工具"),
    ("utilities", "工具"),
    ("program", "程序"),
    ("programs", "程序"),
    ("software", "软件"),
    ("hardware", "硬件"),
    ("platform", "平台"),
    ("platforms", "平台"),
    ("system", "系统"),
    ("systems", "系统"),
    ("solution", "方案"),
    ("solutions", "方案"),
    ("product", "产品"),
    ("products", "产品"),
    ("version", "版本"),
    ("versions", "版本"),
    ("edition", "版本"),
    ("copy", "副本"),
    ("example", "示例"),
    ("examples", "示例"),
    ("sample", "示例"),
    ("samples", "示例"),
    ("demo", "演示"),
    ("demos", "演示"),
    ("tutorial", "教程"),
    ("tutorials", "教程"),
    ("guide", "指南"),
    ("guides", "指南"),
    ("doc", "文档"),
    ("docs", "文档"),
    ("documentation", "文档"),
    ("manual", "手册"),
    ("reference", "参考"),
    ("license", "许可证"),
    ("licence", "许可证"),
    ("copyright", "版权"),
    ("author", "作者"),
    ("authors", "作者"),
    ("owner", "所有者"),
    ("team", "团队"),
    ("teams", "团队"),
    ("community", "社区"),
    ("organization", "组织"),
    ("organisation", "组织"),
    ("company", "公司"),
    ("sponsor", "赞助"),
    ("sponsors", "赞助"),
    ("donate", "捐赠"),
    ("donation", "捐赠"),
    ("contribution", "贡献"),
    ("contributions", "贡献"),
    ("contributing", "参与贡献"),
    ("feedback", "反馈"),
    ("question", "问题"),
    ("questions", "问题"),
    ("answer", "答案"),
    ("answers", "答案"),
    ("problem", "问题"),
    ("problems", "问题"),
    ("solution", "解决方案"),
    ("idea", "想法"),
    ("ideas", "想法"),
    ("goal", "目标"),
    ("goals", "目标"),
    ("purpose", "目的"),
    ("reason", "原因"),
    ("reasons", "原因"),
    ("benefit", "优势"),
    ("benefits", "优势"),
    ("advantage", "优势"),
    ("disadvantage", "缺点"),
    ("limitation", "限制"),
    ("limitations", "限制"),
    ("requirement", "要求"),
    ("requirements", "要求"),
    ("prerequisite", "前置条件"),
    ("prerequisites", "前置条件"),
    ("step", "步骤"),
    ("steps", "步骤"),
    ("note", "注意"),
    ("notes", "说明"),
    ("warning", "警告"),
    ("tip", "提示"),
    ("tips", "提示"),
    ("caution", "小心"),
    ("danger", "危险"),
    ("important", "重要"),
    ("optional", "可选"),
    ("default", "默认"),
    ("custom", "自定义"),
    ("customize", "自定义"),
    ("experimental", "实验性"),
    ("stable", "稳定"),
    ("unstable", "不稳定"),
    ("beta", "测试版"),
    ("alpha", "内测版"),
    ("preview", "预览"),
    ("nightly", "每日构建"),
    ("latest", "最新"),
    ("current", "当前"),
    ("recent", "最近"),
    ("upcoming", "即将推出"),
    ("previous", "之前"),
    ("next", "下一个"),
    ("first", "第一"),
    ("last", "最后"),
    ("new", "新"),
    ("old", "旧"),
    ("modern", "现代"),
    ("simple", "简单"),
    ("easy", "容易"),
    ("fast", "快速"),
    ("quick", "快速"),
    ("slow", "慢"),
    ("lightweight", "轻量"),
    ("tiny", "极小"),
    ("small", "小型"),
    ("large", "大型"),
    ("big", "大型"),
    ("powerful", "强大"),
    ("minimal", "极简"),
    ("flexible", "灵活"),
    ("robust", "健壮"),
    ("secure", "安全"),
    ("safe", "安全"),
    ("efficient", "高效"),
    ("reliable", "可靠"),
    ("portable", "便携"),
    ("complete", "完整"),
    ("full", "完整"),
    ("partial", "部分"),
    ("basic", "基础"),
    ("advanced", "进阶"),
    ("simple", "简单"),
    ("complex", "复杂"),
    ("free", "免费"),
    ("paid", "付费"),
    ("premium", "高级"),
    ("pro", "专业版"),
    ("enterprise", "企业版"),
    ("official", "官方"),
    ("unofficial", "非官方"),
    ("community", "社区"),
    ("public", "公开"),
    ("private", "私有"),
    ("internal", "内部"),
    ("external", "外部"),
    ("local", "本地"),
    ("global", "全局"),
    ("shared", "共享"),
    ("dedicated", "专用"),
    ("generic", "通用"),
    ("specific", "特定"),
    ("general", "通用"),
    ("standard", "标准"),
    ("custom", "自定义"),
    ("native", "原生"),
    ("pure", "纯"),
    ("single", "单个"),
    ("multiple", "多个"),
    ("multi", "多"),
    ("auto", "自动"),
    ("automatic", "自动"),
    ("manual", "手动"),
    ("interactive", "交互式"),
    ("responsive", "响应式"),
    ("static", "静态"),
    ("dynamic", "动态"),
    ("lazy", "懒"),
    ("eager", "立即"),
    ("raw", "原始"),
    ("encoded", "编码后"),
    ("encrypted", "加密后"),
    ("formatted", "格式化后"),
    ("typed", "类型化"),
    ("untyped", "无类型"),
    ("strongly", "强"),
    ("weakly", "弱"),
    ("thread safe", "线程安全"),
    ("zero", "零"),
    ("one", "一"),
    ("two", "二"),
    ("three", "三"),
    ("many", "许多"),
    ("several", "若干"),
    ("all", "所有"),
    ("any", "任何"),
    ("each", "每个"),
    ("every", "每个"),
    ("both", "两者"),
    ("some", "一些"),
    ("none", "无"),
    ("other", "其他"),
    ("another", "另一个"),
    ("same", "相同"),
    ("different", "不同"),
    ("various", "多种"),
    ("more", "更多"),
    ("most", "大多数"),
    ("less", "更少"),
    ("least", "最少"),
    ("few", "少数"),
    ("only", "仅"),
    ("also", "也"),
    ("just", "仅"),
    ("even", "甚至"),
    ("still", "仍然"),
    ("already", "已经"),
    ("always", "总是"),
    ("never", "从不"),
    ("often", "经常"),
    ("usually", "通常"),
    ("sometimes", "有时"),
    ("again", "再次"),
    ("now", "现在"),
    ("then", "然后"),
    ("here", "这里"),
    ("there", "那里"),
    ("very", "非常"),
    ("really", "真正"),
    ("quite", "相当"),
    ("rather", "相当"),
    ("too", "也"),
    ("well", "良好"),
    ("better", "更好"),
    ("best", "最佳"),
    ("good", "好"),
    ("great", "很好"),
    ("nice", "不错"),
    ("bad", "差"),
    ("hard", "困难"),
    ("difficult", "困难"),
    ("possible", "可能"),
    ("impossible", "不可能"),
    ("available", "可用"),
    ("unavailable", "不可用"),
    ("ready", "就绪"),
    ("done", "已完成"),
    ("todo", "待办"),
    ("wip", "进行中"),
    ("draft", "草稿"),
    ("final", "最终"),
    ("true", "真"),
    ("false", "假"),
    ("yes", "是"),
    ("no", "否"),
    ("ok", "正常"),
    ("okay", "正常"),
    ("fail", "失败"),
    ("failed", "失败"),
    ("failure", "失败"),
    ("success", "成功"),
    ("successful", "成功"),
    ("successfully", "成功"),
    ("pending", "待处理"),
    ("active", "活跃"),
    ("inactive", "不活跃"),
    ("enabled", "启用"),
    ("disabled", "禁用"),
    ("valid", "有效"),
    ("invalid", "无效"),
    ("empty", "空"),
    ("missing", "缺失"),
    ("unknown", "未知"),
    ("unsupported", "不支持"),
    ("supported", "支持"),
    ("required", "必需"),
    ("optional", "可选"),

    // 虚词与连接
    ("the", ""),
    ("a", ""),
    ("an", ""),
    ("this", "这个"),
    ("that", "该"),
    ("these", "这些"),
    ("those", "那些"),
    ("it", "它"),
    ("its", "其"),
    ("they", "它们"),
    ("them", "它们"),
    ("their", "它们的"),
    ("we", "我们"),
    ("our", "我们的"),
    ("us", "我们"),
    ("you", "你"),
    ("your", "你的"),
    ("i", "我"),
    ("my", "我的"),
    ("me", "我"),
    ("he", "他"),
    ("she", "她"),
    ("his", "他的"),
    ("her", "她的"),
    ("who", "谁"),
    ("what", "什么"),
    ("which", "哪个"),
    ("where", "哪里"),
    ("when", "何时"),
    ("why", "为什么"),
    ("how", "如何"),
    ("is", "是"),
    ("are", "是"),
    ("was", "是"),
    ("were", "是"),
    ("be", "是"),
    ("been", "是"),
    ("being", "正在"),
    ("am", "是"),
    ("has", "有"),
    ("have", "有"),
    ("had", "有"),
    ("having", "有"),
    ("do", "做"),
    ("does", "做"),
    ("did", "做"),
    ("doing", "做"),
    ("can", "可以"),
    ("could", "可以"),
    ("will", "将"),
    ("would", "会"),
    ("shall", "将"),
    ("should", "应该"),
    ("may", "可能"),
    ("might", "可能"),
    ("must", "必须"),
    ("need", "需要"),
    ("needs", "需要"),
    ("want", "想要"),
    ("wants", "想要"),
    ("like", "像"),
    ("not", "不"),
    ("no", "不"),
    ("never", "从不"),
    ("and", "和"),
    ("or", "或"),
    ("but", "但"),
    ("if", "如果"),
    ("else", "否则"),
    ("when", "当"),
    ("while", "当"),
    ("because", "因为"),
    ("since", "由于"),
    ("so", "所以"),
    ("than", "比"),
    ("as", "作为"),
    ("of", "的"),
    ("to", "到"),
    ("from", "从"),
    ("in", "在"),
    ("on", "在"),
    ("at", "在"),
    ("by", "由"),
    ("for", "用于"),
    ("with", "带有"),
    ("without", "不带"),
    ("via", "通过"),
    ("through", "通过"),
    ("per", "每"),
    ("between", "之间"),
    ("among", "之中"),
    ("over", "超过"),
    ("under", "下方"),
    ("into", "到"),
    ("onto", "到"),
    ("about", "关于"),
    ("around", "大约"),
    ("across", "跨"),
    ("along", "沿"),
    ("against", "针对"),
    ("within", "内部"),
    ("during", "期间"),
    ("before", "之前"),
    ("after", "之后"),
    ("until", "直到"),
    ("unless", "除非"),
    ("however", "然而"),
    ("therefore", "因此"),
    ("thus", "因此"),
    ("hence", "因此"),
    ("otherwise", "否则"),
    ("instead", "而是"),
    ("moreover", "此外"),
    ("furthermore", "此外"),
    ("although", "虽然"),
    ("though", "虽然"),
    ("whether", "是否"),
    ("either", "任一"),
    ("neither", "都不"),
    ("nor", "也不"),
    ("yet", "但"),
    ("still", "仍然"),
    ("already", "已经"),
    ("soon", "很快"),
    ("later", "稍后"),
    ("early", "早期"),
    ("late", "晚"),
    ("currently", "目前"),
    ("typically", "通常"),
    ("generally", "通常"),
    ("specifically", "具体来说"),
    ("especially", "尤其"),
    ("particularly", "尤其"),
    ("simply", "只需"),
    ("easily", "轻松"),
    ("quickly", "快速"),
    ("directly", "直接"),
    ("automatically", "自动"),
    ("manually", "手动"),
    ("together", "一起"),
    ("alone", "单独"),
    ("back", "回"),
    ("forward", "向前"),
    ("up", "上"),
    ("down", "下"),
    ("out", "出"),
    ("off", "关闭"),
    ("on", "在"),

    // ── 第二批：高频但容易漏的词 ──────────────────────
    // 判断标准很简单：拿二十条真实描述翻一遍，哪个词裸露在中文里，
    // 就把它加进来。这一批就是这么攒出来的。
    ("change", "更改"),
    ("changes", "改动"),
    ("changed", "已更改"),
    ("show", "显示"),
    ("shows", "显示"),
    ("shown", "显示"),
    ("showing", "显示"),
    ("display", "显示"),
    ("displays", "显示"),
    ("usage", "用法"),
    ("useful", "有用"),
    ("behavior", "行为"),
    ("behaviors", "行为"),
    ("behaviour", "行为"),
    ("binary", "二进制"),
    ("binaries", "二进制文件"),
    ("codebase", "代码库"),
    ("curriculum", "课程"),
    ("education", "教育"),
    ("educational", "教育"),
    ("content", "内容"),
    ("contents", "内容"),
    ("definitive", "权威"),
    ("interview", "面试"),
    ("learn", "学习"),
    ("learns", "学习"),
    ("learning", "学习"),
    ("prep", "准备"),
    ("prepare", "准备"),
    ("grow", "成长"),
    ("grows", "成长"),
    ("growing", "成长"),
    ("growth", "增长"),
    ("once", "一次"),
    ("twice", "两次"),
    ("transaction", "事务"),
    ("transactions", "事务"),
    ("collective", "集合"),
    ("anything", "任何内容"),
    ("everything", "一切"),
    ("something", "某样东西"),
    ("nothing", "无"),
    ("somebody", "某人"),
    ("reverse", "逆向"),
    ("engineering", "工程"),
    ("engineer", "工程师"),
    ("engineers", "工程师"),
    ("deliver", "交付"),
    ("delivers", "交付"),
    ("delivery", "交付"),
    ("count", "计数"),
    ("counts", "计数"),
    ("counter", "计数器"),
    ("total", "总计"),
    ("sum", "总和"),
    ("average", "平均"),
    ("median", "中位数"),
    ("percent", "百分比"),
    ("percentage", "百分比"),
    ("score", "评分"),
    ("scores", "评分"),
    ("rank", "排名"),
    ("ranks", "排名"),
    ("ranking", "排名"),
    ("trend", "趋势"),
    ("trending", "趋势"),
    ("popular", "流行"),
    ("popularity", "热度"),
    ("awesome", "精选"),
    ("curated", "精选"),
    ("collection", "合集"),
    ("collections", "合集"),
    ("directory", "目录"),
    ("directories", "目录"),
    ("boilerplate", "样板"),
    ("starter", "起步"),
    ("cheatsheet", "速查表"),
    ("handbook", "手册"),
    ("cookbook", "实践手册"),
    ("playbook", "实战手册"),
    ("tracker", "跟踪器"),
    ("dashboard", "仪表盘"),
    ("panels", "面板"),
    ("panel", "面板"),
    ("widget", "小组件"),
    ("widgets", "小组件"),
    ("modal", "模态框"),
    ("dialog", "对话框"),
    ("popup", "弹窗"),
    ("tooltip", "提示气泡"),
    ("sidebar", "侧边栏"),
    ("navbar", "导航栏"),
    ("menu", "菜单"),
    ("menus", "菜单"),
    ("button", "按钮"),
    ("buttons", "按钮"),
    ("input", "输入"),
    ("inputs", "输入"),
    ("form", "表单"),
    ("forms", "表单"),
    ("icon", "图标"),
    ("icons", "图标"),
    ("logo", "标志"),
    ("logos", "标志"),
    ("avatar", "头像"),
    ("badge", "徽章"),
    ("badges", "徽章"),
    ("banner", "横幅"),
    ("card", "卡片"),
    ("cards", "卡片"),
    ("grid", "网格"),
    ("column", "列"),
    ("columns", "列"),
    ("row", "行"),
    ("rows", "行"),
    ("cell", "单元格"),
    ("cells", "单元格"),
    ("pagination", "分页"),
    ("scroll", "滚动"),
    ("scrolling", "滚动"),
    ("scrollbar", "滚动条"),
    ("animation", "动画"),
    ("animations", "动画"),
    ("transition", "过渡"),
    ("transitions", "过渡"),
    ("opacity", "不透明度"),
    ("shadow", "阴影"),
    ("border", "边框"),
    ("padding", "内边距"),
    ("margin", "外边距"),
    ("font", "字体"),
    ("fonts", "字体"),
    ("color", "颜色"),
    ("colors", "颜色"),
    ("colour", "颜色"),
    ("mobile", "移动端"),
    ("desktop", "桌面端"),
    ("tablet", "平板"),
    ("screen", "屏幕"),
    ("screens", "屏幕"),
    ("viewport", "视口"),
    ("resolution", "分辨率"),
    ("pixel", "像素"),
    ("pixels", "像素"),
    ("think", "认为"),
    ("know", "了解"),
    ("understand", "理解"),
    ("try", "尝试"),
    ("tries", "尝试"),
    ("find", "查找"),
    ("finds", "查找"),
    ("look", "查看"),
    ("see", "查看"),
    ("say", "说明"),
    ("tell", "告诉"),
    ("ask", "询问"),
    ("answer", "回答"),
    ("answers", "回答"),
    ("reply", "回复"),
    ("replies", "回复"),
    ("comment", "评论"),
    ("comments", "评论"),
    ("review", "审查"),
    ("reviews", "审查"),
    ("approve", "批准"),
    ("approved", "已批准"),
    ("reject", "拒绝"),
    ("rejected", "已拒绝"),
    ("accept", "接受"),
    ("accepted", "已接受"),
    ("deny", "拒绝"),
    ("grant", "授予"),
    ("revoke", "撤销"),
    ("follow", "关注"),
    ("follows", "关注"),
    ("following", "关注"),
    ("follower", "关注者"),
    ("followers", "关注者"),
    ("subscribe", "订阅"),
    ("subscription", "订阅"),
    ("subscriptions", "订阅"),
    ("notify", "通知"),
    ("notification", "通知"),
    ("notifications", "通知"),
    ("mention", "提及"),
    ("mentions", "提及"),
    ("schema", "模式"),
    ("schemas", "模式"),
    ("snapshot", "快照"),
    ("snapshots", "快照"),
    ("backup", "备份"),
    ("backups", "备份"),
    ("restore", "恢复"),
    ("shard", "分片"),
    ("shards", "分片"),
    ("replica", "副本"),
    ("replicas", "副本"),
    ("consensus", "共识"),
    ("heartbeat", "心跳"),
    ("timeout", "超时"),
    ("timeouts", "超时"),
    ("backoff", "退避"),
    ("throttle", "限流"),
    ("quota", "配额"),
    ("billing", "计费"),
    ("trial", "试用"),
    ("pricing", "定价"),
    ("plan", "套餐"),
    ("plans", "套餐"),
    ("accessibility", "无障碍"),
    ("translation", "翻译"),
    ("translations", "翻译"),
    ("locale", "区域设置"),
    ("language", "语言"),
    ("languages", "语言"),
    ("english", "英语"),
    ("chinese", "中文"),
    ("snippet", "代码片段"),
    ("snippets", "代码片段"),
    ("faq", "常见问题"),
    ("wiki", "Wiki"),
    ("qa", "问答"),
    ("screenshot", "截图"),
    ("screenshots", "截图"),
    ("preview", "预览"),
    ("demo", "演示"),
    ("password", "密码"),
    ("username", "用户名"),
    ("email", "邮箱"),
    ("account", "账户"),
    ("accounts", "账户"),
    ("profile", "个人资料"),
    ("setting", "设置"),
    ("settings", "设置"),
    ("preference", "偏好"),
    ("preferences", "偏好"),
    ("option", "选项"),
    ("parameter", "参数"),
    ("field", "字段"),
    ("fields", "字段"),
    ("attribute", "属性"),
    ("attributes", "属性"),
    ("property", "属性"),
    ("properties", "属性"),
    ("method", "方法"),
    ("event", "事件"),
    ("events", "事件"),
    ("handler", "处理器"),
    ("handlers", "处理器"),
    ("listener", "监听器"),
    ("emitter", "发射器"),
    ("channel", "通道"),
    ("channels", "通道"),
    ("topic", "主题"),
    ("topics", "主题"),
    ("thread", "线程"),
    ("worker", "工作线程"),
    ("workers", "工作线程"),
    ("job", "任务"),
    ("jobs", "任务"),
    ("task", "任务"),
    ("tasks", "任务"),
    ("schedule", "调度"),
    ("scheduler", "调度器"),
    ("scheduled", "已调度"),
    ("cron", "定时"),
    ("interval", "间隔"),
    ("delay", "延迟"),
    ("duration", "时长"),
    ("timestamp", "时间戳"),
    ("date", "日期"),
    ("time", "时间"),
    ("date time", "日期时间"),
    ("datetime", "日期时间"),
    ("format", "格式"),
    ("formats", "格式"),
    ("size", "大小"),
    ("sizes", "大小"),
    ("length", "长度"),
    ("width", "宽度"),
    ("height", "高度"),
    ("depth", "深度"),
    ("weight", "权重"),
    ("rate", "速率"),
    ("ratio", "比率"),
    ("level", "层级"),
    ("levels", "层级"),
    ("range", "范围"),
    ("ranges", "范围"),
    ("limit", "限制"),
    ("limits", "限制"),
    ("maximum", "最大"),
    ("minimum", "最小"),
    ("max", "最大"),
    ("min", "最小"),
    ("upper", "上限"),
    ("lower", "下限"),
    ("left", "左"),
    ("right", "右"),
    ("top", "顶部"),
    ("bottom", "底部"),
    ("center", "中心"),
    ("middle", "中间"),
    ("inner", "内层"),
    ("outer", "外层"),
    ("front", "前"),
    ("rear", "后"),
    ("side", "侧"),
    ("end", "末端"),
    ("start", "开始"),
    ("begin", "开始"),
    ("finish", "完成"),
    ("complete", "完整"),
    ("completed", "已完成"),
    ("cancel", "取消"),
    ("cancelled", "已取消"),
    ("canceled", "已取消"),
    ("abort", "中止"),
    ("exit", "退出"),
    ("quit", "退出"),
    ("pause", "暂停"),
    ("resume", "恢复"),
    ("restart", "重启"),
    ("reload", "重新加载"),
    ("refresh", "刷新"),
    ("refresh", "刷新"),
    ("toggle", "切换"),
    ("switch", "切换"),
    ("select", "选择"),
    ("selected", "已选择"),
    ("choose", "选择"),
    ("pick", "选取"),
    ("drag", "拖拽"),
    ("drop", "放置"),
    ("click", "点击"),
    ("clicks", "点击"),
    ("tap", "轻触"),
    ("press", "按下"),
    ("hold", "按住"),
    ("release", "释放"),
    ("hover", "悬停"),
    ("focus", "聚焦"),
    ("blur", "失焦"),
    ("expand", "展开"),
    ("collapse", "折叠"),
    ("hide", "隐藏"),
    ("hidden", "隐藏"),
    ("visible", "可见"),
    ("invisible", "不可见"),
    ("show", "显示"),
    ("zoom", "缩放"),
    ("resize", "调整大小"),
    ("rotate", "旋转"),
    ("flip", "翻转"),
    ("slide", "滑动"),
    ("swipe", "滑动"),
    ("pinch", "捏合"),

    ("programming", "编程"),
    ("programmer", "程序员"),
    ("programmers", "程序员"),
    ("program", "程序"),
    ("math", "数学"),
    ("maths", "数学"),
    ("mathematics", "数学"),
    ("science", "科学"),
    ("os", "操作系统"),
    ("book", "书"),
    ("books", "书籍"),
    ("ebook", "电子书"),
    ("ebooks", "电子书"),
    ("developer", "开发者"),
    ("developers", "开发者"),
    ("develop", "开发"),
    ("develops", "开发"),
    ("developed", "已开发"),
    ("development", "开发"),
    ("dev", "开发"),
    ("devs", "开发者"),
    ("thing", "事物"),
    ("things", "事物"),
    ("large-scale", "大规模"),
    ("small-scale", "小规模"),
    ("key-value", "键值"),
    ("read-only", "只读"),
    ("write-only", "只写"),
    ("read-write", "读写"),
    ("end-user", "最终用户"),
    ("real-world", "真实场景"),
    ("state-of-the-art", "最先进"),
    ("cutting-edge", "前沿"),
    ("best-practice", "最佳实践"),
    ("best-practices", "最佳实践"),
    ("user-friendly", "易用"),
    ("developer-friendly", "对开发者友好"),
    ("well-documented", "文档完善"),
    ("well-tested", "经过充分测试"),
    ("production-ready", "可投入生产"),
    ("battle-tested", "久经考验"),
    ("light-weight", "轻量"),
    ("low-level", "底层"),
    ("high-level", "高层"),
    ("top-level", "顶层"),
    ("low-latency", "低延迟"),
    ("high-throughput", "高吞吐"),
    ("fault-tolerant", "容错"),
    ("event-driven", "事件驱动"),
    ("object-oriented", "面向对象"),
    ("functional", "函数式"),
    ("declarative", "声明式"),
    ("imperative", "命令式"),
    ("reactive", "响应式"),
    ("immutable", "不可变"),
    ("mutable", "可变"),
    ("stateless", "无状态"),
    ("stateful", "有状态"),
    ("idempotent", "幂等"),
    ("deterministic", "确定性"),
    ("recursive", "递归"),
    ("iterative", "迭代"),
    ("verbose", "冗长"),
    ("concise", "简洁"),
    ("elegant", "优雅"),
    ("intuitive", "直观"),
    ("seamless", "无缝"),
    ("effortless", "毫不费力"),
    ("straightforward", "直接明了"),
    ("opinionated", "有主见"),
    ("unopinionated", "无预设"),
    ("minimalist", "极简"),
    ("blazing", "极快"),
    ("instant", "即时"),
    ("immediate", "立即"),
    ("eventual", "最终"),
    ("gradual", "渐进"),
    ("incremental", "增量"),
    ("backward", "向后"),
    ("forward", "向前"),

    // 关系代词：技术描述里多是从句引导词，译出来反而挡路
    ("that", ""),
    ("which", ""),
    ("who", ""),
    ("whom", ""),
    ("whose", "其"),
    ("abstraction", "抽象"),
    ("markup", "标记"),
    ("automated", "自动化"),
    ("automate", "自动化"),
    ("automation", "自动化"),
    ("interaction", "交互"),
    ("interactions", "交互"),
    ("fake", "模拟"),
    ("name", "名称"),
    ("names", "名称"),
    ("address", "地址"),
    ("addresses", "地址"),
    ("phone", "电话"),
    ("number", "数量"),
    ("numbers", "数量"),
    ("geocoding", "地理编码"),
    ("micro-framework", "微框架"),
    ("web-application", "Web 应用"),
    ("web-applications", "Web 应用"),
    ("delightful", "令人愉悦"),
    ("community-driven", "社区驱动"),
    ("community-based", "社区共建"),
    ("spice", "点缀"),
    ("morning", "早晨"),
    ("recognition", "识别"),
    ("generator", "生成器"),
    ("generators", "生成器"),
    ("structured", "结构化"),
    ("unstructured", "非结构化"),
    ("capture", "捕获"),
    ("capturing", "捕获"),
    ("metric", "指标"),
    ("metrics", "指标"),
    ("going", "运行"),
    ("virtual", "虚拟"),
    ("conferencing", "会议"),
    ("attack", "攻击"),
    ("attacks", "攻击"),
    ("traffic", "流量"),
    ("analysis", "分析"),
    ("analyze", "分析"),
    ("analyse", "分析"),
    ("analytics", "分析"),
    ("protection", "保护"),
    ("protect", "保护"),
    ("protected", "受保护"),
    ("footprint", "占用"),
    ("implementation", "实现"),
    ("implementations", "实现"),
    ("report", "报告"),
    ("reports", "报告"),
    ("reported", "报告"),
    ("reporting", "报告"),
    ("incorrectly", "错误地"),
    ("correctly", "正确地"),
    ("incorrect", "不正确"),
    ("correct", "正确"),
    ("savant", "专家"),
    ("interpreter", "解释器"),
    ("speed", "速度"),
    ("transport", "传输"),
    ("asynchronous", "异步"),
    ("synchronous", "同步"),
    ("blocking", "阻塞"),
    ("non-blocking", "非阻塞"),
    ("haiku", "俳句"),
    ("emoji", "表情符号"),
    ("badges", "徽章"),
    ("wraps", "封装"),
    ("wrapper", "包装"),
    ("libcurl", "libcurl"),
    ("spice up", "点缀"),
    ("going on", "发生"),
    ("what's going on", "发生了什么"),
    ("keeps track of", "跟踪"),
    ("keep track of", "跟踪"),
    ("takes care of", "负责"),
    ("take care of", "负责"),
    ("in charge of", "负责"),
    ("instead", "代替"),
    ("rather than", "而不是"),
    ("as opposed to", "相对于"),
    ("along the lines of", "类似于"),
    ("in the same way", "同样"),
    ("by means of", "通过"),
    ("with the help of", "借助"),
    ("in case of", "万一"),
    ("in the case of", "对于"),
    ("as of", "截至"),
    ("prior to", "在之前"),
    ("next to", "旁边"),
    ("close to", "接近"),
    ("due to", "由于"),
    ("owing to", "由于"),
    ("thanks to", "得益于"),
    // ── 第三批：按真实种子库的漏词频次补的 ──────────
    ("engine", "引擎"),
    ("engines", "引擎"),
    ("alternative", "替代"),
    ("alternatives", "替代方案"),
    ("browser", "浏览器"),
    ("browsers", "浏览器"),
    ("own", "自己的"),
    ("manager", "管理器"),
    ("control", "控制"),
    ("controlled", "受控"),
    ("controller", "控制器"),
    ("network", "网络"),
    ("networks", "网络"),
    ("game", "游戏"),
    ("games", "游戏"),
    ("editor", "编辑器"),
    ("device", "设备"),
    ("devices", "设备"),
    ("skill", "技能"),
    ("skills", "技能"),
    ("video", "视频"),
    ("videos", "视频"),
    ("way", "方式"),
    ("ways", "方式"),
    ("text", "文本"),
    ("work", "工作"),
    ("works", "工作"),
    ("working", "工作"),
    ("distributed", "分布式"),
    ("real", "真实"),
    ("chat", "聊天"),
    ("machine", "机器"),
    ("machines", "机器"),
    ("security", "安全"),
    ("player", "播放器"),
    ("iphone", "iPhone"),
    ("powered", "驱动"),
    ("self-hosted", "自托管"),
    ("workspace", "工作区"),
    ("line", "行"),
    ("lines", "行"),
    ("harness", "框架"),
    ("mirror", "镜像"),
    ("mirrors", "镜像"),
    ("customizable", "可定制"),
    ("customization", "定制"),
    ("highly", "高度"),
    ("live", "实时"),
    ("music", "音乐"),
    ("document", "文档"),
    ("documents", "文档"),
    ("access", "访问"),
    ("core", "核心"),
    ("media", "媒体"),
    ("extensible", "可扩展"),
    ("extendable", "可扩展"),
    ("resource", "资源"),
    ("resources", "资源"),
    ("visual", "可视化"),
    ("intelligence", "智能"),
    ("artificial intelligence", "人工智能"),
    ("assistant", "助手"),
    ("firmware", "固件"),
    ("faster", "更快"),
    ("fastest", "最快"),
    ("compatible", "兼容"),
    ("keyboard", "键盘"),
    ("local-first", "本地优先"),
    ("voice", "语音"),
    ("fully", "完全"),
    ("etc", "等"),
    ("research", "研究"),
    ("generation", "生成"),
    ("modular", "模块化"),
    ("persistent", "持久"),
    ("anywhere", "任何地方"),
    ("knowledge", "知识"),
    ("orchestration", "编排"),
    ("orchestrate", "编排"),
    ("bar", "栏"),
    ("provider", "提供方"),
    ("providers", "提供方"),
    ("graph", "图"),
    ("context", "上下文"),
    ("audio", "音频"),
    ("everyone", "所有人"),
    ("computer", "计算机"),
    ("computers", "计算机"),
    ("experience", "体验"),
    ("unified", "统一"),
    ("ecosystem", "生态"),
    ("production", "生产"),
    ("autonomous", "自主"),
    ("reader", "阅读器"),
    ("operating", "运行"),
    ("power", "能力"),
    ("inspired", "启发"),
    ("launcher", "启动器"),
    ("offline", "离线"),
    ("online", "在线"),
    ("beautiful", "美观"),
    ("viewer", "查看器"),
    ("view", "查看"),
    ("views", "视图"),
    ("edit", "编辑"),
    ("editing", "编辑"),
    ("bot", "机器人"),
    ("bots", "机器人"),
    ("key", "键"),
    ("keys", "键"),
    ("observability", "可观测性"),
    ("detection", "检测"),
    ("personal", "个人"),
    ("setup", "设置"),
    ("capability", "能力"),
    ("capabilities", "能力"),
    ("internet", "互联网"),
    ("smart", "智能"),
    ("multi-platform", "多平台"),
    ("comprehensive", "全面"),
    ("replacement", "替代品"),
    ("space", "空间"),
    ("on-device", "端侧"),
    ("plus", "以及"),
    ("human", "人类"),
    ("humans", "人类"),
    ("compression", "压缩"),
    ("trading", "交易"),
    ("agentic", "智能体"),
    ("emulator", "模拟器"),
    ("infrastructure", "基础设施"),
    ("real-time", "实时"),
    ("open-source", "开源"),
    ("cross-platform", "跨平台"),
    ("high-performance", "高性能"),
    ("command-line", "命令行"),
    ("built-in", "内置"),
    ("easy-to-use", "易于使用"),
    ("from scratch", "从零开始"),
    ("state of the art", "最先进"),
    ("under the hood", "底层"),
    ("all in one", "一体化"),
    ("all-in-one", "一体化"),
    ("high", "高"),
    ("clean", "干净"),
    ("collaborative", "协作"),
    ("collaboration", "协作"),
    ("collaborate", "协作"),
    ("simulation", "模拟"),
    ("chart", "图表"),
    ("charts", "图表"),
    ("cost", "成本"),
    ("costs", "成本"),
    ("architecture", "架构"),
    ("people", "人员"),
    ("suite", "套件"),
    ("history", "历史"),
    ("link", "链接"),
    ("links", "链接"),
    ("main", "主"),
    ("scanner", "扫描器"),
    ("scanners", "扫描器"),
    ("pipeline", "流水线"),
    ("pipelines", "流水线"),
    ("vulnerability", "漏洞"),
    ("vulnerabilities", "漏洞"),
    ("everywhere", "到处"),
    ("universal", "通用"),
    ("digital", "数字"),
    ("deep", "深度"),
    ("decision", "决策"),
    ("such", "这样的"),
    ("ipad", "iPad"),
    ("world", "世界"),
    ("worlds", "世界"),
    ("crypto", "加密"),
    ("edge", "边缘"),
    ("mode", "模式"),
    ("feature-rich", "功能丰富"),
    ("full-featured", "功能完整"),
    ("multi-agent", "多智能体"),
    ("graphics", "图形"),
    ("output", "输出"),
    ("outputs", "输出"),
    ("tree", "树"),
    ("plane", "飞机"),
    ("silicon", "芯片"),
    ("quality", "质量"),
    ("telemetry", "遥测"),
    ("payment", "支付"),
    ("payments", "支付"),
    ("workload", "负载"),
    ("workloads", "负载"),
    ("place", "位置"),
    ("decompilation", "反编译"),
    ("status", "状态"),
    ("visualization", "可视化"),
    ("visualize", "可视化"),
    ("toolchain", "工具链"),
    ("original", "原始"),
    ("wallet", "钱包"),
    ("headless", "无头"),
    ("assets", "资源"),
    ("asset", "资源"),
    ("notch", "凹口"),
    ("reusable", "可复用"),
    ("realtime", "实时"),
    ("recompilation", "重编译"),
    ("easiest", "最简便"),
    ("processor", "处理器"),
    ("plain", "纯"),
    ("message", "消息"),
    ("messages", "消息"),
    ("rich", "丰富"),
    ("mouse", "鼠标"),
    ("maintained", "维护"),
    ("rules", "规则"),
    ("rule", "规则"),
    ("fewer", "更少"),
    ("transcription", "转写"),
    ("pattern", "模式"),
    ("patterns", "模式"),
    ("nodejs", "Node.js"),
    ("performant", "高性能"),
    ("diagram", "图表"),
    ("diagrams", "图表"),
    ("push", "推送"),
    ("pushes", "推送"),
    ("contribute", "贡献"),
    ("isolation", "隔离"),
    ("bring", "带来"),
    ("brings", "带来"),
    ("multimodal", "多模态"),
    ("business", "业务"),
    ("aims", "旨在"),
    ("aim", "旨在"),
    ("papers", "论文"),
    ("paper", "论文"),
    ("gives", "提供"),
    ("give", "提供"),
    ("intent", "意图"),
    ("hybrid", "混合"),
    ("discovery", "发现"),
    ("practices", "实践"),
    ("practice", "实践"),
    ("durable", "持久"),
    ("days", "天"),
    ("day", "天"),
    ("audit", "审计"),
    ("lyrics", "歌词"),
    ("common", "常见"),
    ("life", "生活"),
    ("ads", "广告"),
    ("ad", "广告"),
    ("art", "艺术"),
    ("simulator", "模拟器"),
    ("mind", "思维"),
    ("privacy", "隐私"),
    ("privacy-first", "隐私优先"),
    ("linter", "代码检查器"),
    ("compatibility", "兼容性"),
    ("technology", "技术"),
    ("technologies", "技术"),
    ("algorithm", "算法"),
    ("algorithms", "算法"),
    ("classic", "经典"),
    ("injection", "注入"),
    ("friendly", "友好"),
    ("compilation", "编译"),
    ("lean", "精简"),
    ("train", "训练"),
    ("decentralized", "去中心化"),
    ("microservices", "微服务"),
    ("entire", "整个"),
    ("camera", "摄像头"),
    ("productivity", "生产力"),
    ("github", "GitHub"),
    ("logic", "逻辑"),
    ("alert", "告警"),
    ("alerts", "告警"),
    ("formatter", "格式化器"),
    ("built", "构建"),
    ("based", "基于"),
    ("explore", "探索"),
    ("exploring", "探索"),
    ("explores", "探索"),
    ("exploration", "探索"),
    ("opensource", "开源"),
    ("alternative to", "替代"),
    ("as an alternative to", "作为替代"),
    ("want to", "想"),
    ("wants to", "想"),
    ("wanted to", "想"),
    ("would like to", "想要"),
    ("need to", "需要"),
    ("needs to", "需要"),
    ("able to", "能够"),
    ("going to", "将要"),
    ("have to", "必须"),
    ("has to", "必须"),
    ("used to be", "曾经是"),
    ("tend to", "倾向于"),
    ("fail to", "未能"),
    ("manage to", "设法"),
    ("in order for", "为了让"),
    ("in zig", "基于 Zig"),
    ("in rust", "基于 Rust"),
    ("in python", "基于 Python"),
    ("in go", "基于 Go"),
    ("in java", "基于 Java"),
    ("in c", "基于 C"),
    ("a number of", "若干"),
    ("there are", "有"),
    ("there is", "有"),
    ("can be found", "可在"),
    ("learn more about", "了解更多关于"),
    ("more about", "更多关于"),
    ("getting started", "入门"),
    ("below", "下方"),
    ("comprehensive", "全面"),
    ("options", "选项"),
    ("ways", "方式"),
    ("your", "你的"),
    ("system", "系统"),
    ("transparent", "透明"),
    ("studio", "工作台"),
    ("where", ""),
    // ── 第二批实测补词（README 正文里反复出现、之前被漏掉的）──
    ("drawn", "绘制"),
    ("draw", "绘制"),
    ("draws", "绘制"),
    ("drawing", "绘制"),
    ("render", "渲染"),
    ("renders", "渲染"),
    ("renderer", "渲染器"),
    ("illustration", "插图"),
    ("recorder", "录制器"),
    ("record", "录制"),
    ("flight", "航班"),
    ("mail", "邮件"),
    ("shelf", "货架"),
    ("activity", "活动"),
    ("meet", "认识"),
    ("meets", "认识"),
    ("kind", "种类"),
    ("kinds", "种类"),
    ("part", "部分"),
    ("parts", "部分"),
    ("turns", "轮次"),
    ("doesnt", "不"),
    ("scratch", "从零"),
    ("clipboard", "剪贴板"),
    ("pull", "拉取"),
    ("pulls", "拉取"),
    ("extremely", "极其"),
    ("marketplace", "市场"),
    ("hub", "中心"),
    ("enhanced", "增强"),
    ("distribution", "发行版"),
    ("challenge", "挑战"),
    ("daily", "每日"),
    ("offers", "提供"),
    ("stats", "统计"),
    ("canvas", "画布"),
    ("retrieval", "检索"),
    ("sophisticated", "复杂"),
    ("intelligent", "智能"),
    ("much", "许多"),
    ("natural", "自然"),
    ("embeddable", "可嵌入"),
    ("swap", "交换"),
    ("information", "信息"),
    ("sandbox", "沙箱"),
    ("configurable", "可配置"),
    ("professional", "专业"),
    ("mission", "使命"),
    ("logger", "日志器"),
    ("creation", "创建"),
    ("composable", "可组合"),
    ("catalog", "目录"),
    ("downloader", "下载器"),
    ("computing", "计算"),
    ("era", "时代"),
    ("balance", "平衡"),
    ("watch", "关注"),
    ("countries", "国家"),
    ("leading", "领先"),
    ("radio", "电台"),
    ("operations", "运营"),
    ("social", "社交"),
    ("loop", "循环"),
    ("techniques", "技术"),
    ("builder", "构建器"),
    ("favorite", "收藏"),
    ("scraping", "爬取"),
    ("animated", "动画"),
    ("bypass", "绕过"),
    ("ultimate", "终极"),
    ("similar", "类似"),
    ("cloud-native", "云原生"),
    ("enterprise-grade", "企业级"),
    ("next-generation", "新一代"),
    ("data-driven", "数据驱动"),
    ("in use", "使用中"),
    ("see it", "看到它"),
];

/// 永不翻译：产品名、协议名、以及带代码特征的词。
/// 这些留着英文反而好读——把 `npm` 译成「节点包管理器」只会让人卡一下。
const KEEP: &[&str] = &[
    "git", "github", "gitlab", "npm", "yarn", "pnpm", "npx", "node", "deno", "bun", "python",
    "pip", "rust", "cargo", "go", "golang", "java", "maven", "gradle", "kotlin", "swift",
    "ruby", "gem", "php", "composer", "perl", "lua", "dotnet", "nuget", "cmake", "make",
    "react", "vue", "angular", "svelte", "next", "nuxt", "vite", "webpack", "rollup", "esbuild",
    "babel", "eslint", "prettier", "jest", "vitest", "mocha", "cypress", "playwright",
    "typescript", "javascript", "js", "ts", "jsx", "tsx", "wasm", "webassembly",
    "rust", "tokio", "serde", "tauri", "actix", "axum", "diesel", "sqlx", "zig", "elixir", "haskell", "scala", "clojure", "erlang", "ocaml", "nim", "crystal", "dart", "flutter",  
    "django", "flask", "fastapi", "rails", "laravel", "spring", "express", "koa", "nest",
    "postgres", "postgresql", "mysql", "sqlite", "redis", "mongo", "mongodb", "kafka",
    "rabbitmq", "nginx", "apache", "caddy", "traefik",
    "linux", "macos", "windows", "android", "ios", "ubuntu", "debian", "centos", "alpine", "tvos", "watchos", "ipados", "nodejs",  
    "docker", "kubernetes", "k8s", "terraform", "ansible", "helm", "istio",
    "aws", "azure", "gcp", "cloudflare", "vercel", "netlify", "heroku", "fly",
    "openai", "anthropic", "claude", "gpt", "llama", "mistral", "qwen", "deepseek",
    "mit", "apache", "bsd", "gpl", "lgpl", "mpl", "unlicense",
];

fn phrase_map() -> &'static HashMap<String, &'static str> {
    static M: OnceLock<HashMap<String, &'static str>> = OnceLock::new();
    M.get_or_init(|| {
        let mut m: HashMap<String, &'static str> = HashMap::new();
        for (k, v) in PHRASES.iter() {
            m.insert(k.to_lowercase(), *v);
        }
        // 词表里带空格的其实是短语。漏在那边就永远匹配不上，
        // 顺手收进来，省得以后再加词时又要纠结该写在哪张表。
        // 键统一转小写：查表时窗口是小写的，写 `in Zig` 就永远查不到。
        for (k, v) in WORDS.iter() {
            if k.contains(' ') {
                m.entry(k.to_lowercase()).or_insert(*v);
            }
        }
        m
    })
}

fn word_map() -> &'static HashMap<&'static str, &'static str> {
    static M: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    M.get_or_init(|| {
        // 后面的条目覆盖前面的：同一词条写两遍时，以最后一条为准，
        // 这样修正一个译法不用翻遍全表。
        let mut m = HashMap::new();
        // 单词条也可能写在 PHRASES 里（两张表都是平铺的，加词时容易放错）。
        // 先把 PHRASES 里不带空格的收进来，WORDS 覆盖它——这样无论写在哪张表，
        // 单词都能走 lookup 的词形还原，`refreshingly` 才认得出 `refreshing`。
        for (k, v) in PHRASES.iter() {
            if !k.contains(' ') {
                m.insert(*k, *v);
            }
        }
        for (k, v) in WORDS.iter() {
            m.insert(*k, *v);
        }
        m
    })
}

fn keep_set() -> &'static std::collections::HashSet<&'static str> {
    static S: OnceLock<std::collections::HashSet<&'static str>> = OnceLock::new();
    S.get_or_init(|| KEEP.iter().copied().collect())
}

/// 词形还原。只处理最常见的三种后缀，够覆盖 README 里的绝大多数变形。
fn lemma(w: &str) -> Vec<String> {
    let mut out = vec![w.to_string()];
    let n = w.len();
    if n > 4 && w.ends_with("ies") {
        out.push(format!("{}y", &w[..n - 3]));
    }
    if n > 4 && w.ends_with("es") {
        out.push(w[..n - 2].to_string());
    }
    if n > 3 && w.ends_with('s') && !w.ends_with("ss") {
        out.push(w[..n - 1].to_string());
    }
    if n > 5 && w.ends_with("ing") {
        out.push(w[..n - 3].to_string());
        out.push(format!("{}e", &w[..n - 3]));
        // running → run
        if w.as_bytes()[n - 4] == w.as_bytes()[n - 5] {
            out.push(w[..n - 4].to_string());
        }
    }
    if n > 4 && w.ends_with("ed") {
        out.push(w[..n - 2].to_string());
        out.push(format!("{}e", &w[..n - 2]));
        if n > 5 && w.as_bytes()[n - 3] == w.as_bytes()[n - 4] {
            out.push(w[..n - 3].to_string());
        }
    }
    if n > 5 && w.ends_with("ly") {
        out.push(w[..n - 2].to_string());
    }
    out
}

fn lookup(w: &str) -> Option<&'static str> {
    let mut low = w.to_lowercase();
    // org's → org：所有格不影响词义
    if let Some(stripped) = low.strip_suffix("'s") {
        low = stripped.to_string();
    }
    let low = low.trim_matches('\'');
    if let Some(v) = word_map().get(low) {
        return Some(v);
    }
    for c in lemma(low) {
        if let Some(v) = word_map().get(c.as_str()) {
            return Some(v);
        }
    }
    None
}

/// 该不该整词保留。带下划线、数字、路径的都算代码标识符。
/// 驼峰只认「首字母小写 + 中间有大写」（getUserById），
/// 因为 `APIs` `URLs` `HTTPRequest` 这种缩写开头的不该被挡在门外。
/// 这些词是编程语言名。用来判断 `built in X` 里的 in 到底是
/// 「内置」还是「用 X 写的」——后者才是 GitHub README 里的常见意思。
fn is_lang(w: &str) -> bool {
    matches!(
        w.to_lowercase().as_str(),
        "rust" | "go" | "golang" | "python" | "javascript" | "typescript" | "zig" | "c"
            | "cpp" | "java" | "kotlin" | "swift" | "ruby" | "php" | "csharp" | "scala"
            | "haskell" | "elixir" | "erlang" | "lua" | "dart" | "nim" | "julia" | "shell"
            | "bash" | "html" | "css" | "sql" | "assembly" | "ocaml" | "clojure" | "perl"
            | "svelte" | "vue" | "react" | "flutter"
    )
}

fn is_code_token(w: &str) -> bool {
    if w.contains('_') || w.contains('/') || w.contains('\\') || w.contains('@') {
        return true;
    }
    if w.chars().any(|c| c.is_ascii_digit()) {
        return true;
    }
    let bytes = w.as_bytes();
    if bytes.len() > 2 && bytes[0].is_ascii_lowercase() {
        if bytes[1..].iter().any(|b| b.is_ascii_uppercase()) {
            return true;
        }
    }
    false
}

/// 一次翻译的产物：译文 + 是否有未译词。
pub struct Out {
    pub text: String,
    pub kept: usize,
}

/// 把一个英文句子翻成技术直译中文。
pub fn translate(sentence: &str) -> Out {
    let mut kept = 0usize;
    // 先分句内片段：按 of 切，最后再倒序拼，处理「A of B」→「B 的 A」
    // 一个 of 才谈得上倒装；三个以上的 of 倒序拼出来一定更糊，
    // 干脆整句顺译，`of` 交给词表译成「的」，读起来至少还跟得上。
    let mut segments = split_of(sentence);
    if segments.len() > 2 {
        segments = vec![sentence];
    } else if segments.len() == 2 && segments[0].split_whitespace().count() > 5 {
        // 前半句太长就不是名词短语了（GitNexus indexes a codebase into a
        // knowledge graph of ...），倒装只会把从句也翻过来，不如不倒
        segments = vec![sentence];
    }
    let mut rendered: Vec<String> = Vec::new();
    for seg in segments {
        let mut s = translate_flat(seg, &mut kept);
        if s.trim().is_empty() {
            s = String::new();
        }
        if !s.is_empty() {
            rendered.push(s);
        }
    }
    // A of B → B 的 A。
    // 但三层以上（one of two kinds of interface）倒序会翻成
    // 「接口的两种类的每个窗口显示一」，不如老老实实顺着来，
    // 中间补个「的」，读起来至少能断句。
    // 拼接前要把各段尾部的标点摘下来，否则会得到「每个进程。的这个窗口」。
    let text = if rendered.len() <= 1 {
        rendered.join("")
    } else if rendered.len() == 2 {
        const CUT: [char; 8] = ['。', '.', '，', ',', '；', ';', '：', ':'];
        let last = rendered.last().cloned().unwrap_or_default();
        let body = last.trim_end_matches(CUT);
        let tail = &last[body.len()..];
        let head = rendered[0].trim_end_matches(CUT).trim();
        let mut acc = body.to_string();
        if !head.is_empty() {
            acc = if acc.is_empty() {
                head.to_string()
            } else {
                format!("{}的{}", acc, head)
            };
        }
        acc.push_str(tail);
        acc
    } else {
        const CUT: [char; 8] = ['。', '.', '，', ',', '；', ';', '：', ':'];
        let last = rendered.last().cloned().unwrap_or_default();
        let body = last.trim_end_matches(CUT);
        let tail = &last[body.len()..];
        let mut acc = String::new();
        for (n, p) in rendered.iter().enumerate() {
            let p = if n + 1 == rendered.len() {
                body
            } else {
                p.trim_end_matches(CUT).trim()
            };
            if p.is_empty() {
                continue;
            }
            if !acc.is_empty() {
                acc.push('的');
            }
            acc.push_str(p);
        }
        acc.push_str(tail);
        acc
    };
    Out { text, kept }
}

/// 按 " of " 切开。只切真正的介词 of，不切 "a lot of" 这种已经被
/// 短语表吃掉的组合（它们会先被识别成整体，这里只看裸的 of）。
///
/// 按字节扫描但要保证只切在 ASCII 边界上：`of` 的 'o' 是 0x6F，
/// 而 UTF-8 的续字节都在 0x80 以上，所以 `b[i] == b'o'` 只会命中真正的
/// ASCII 'o'——切口一定落在字符边界，可以安全地切 `&s[..]`。
/// （遮罩用的 `⟦n⟧` 是非 ASCII，所以这里不能像以前那样遇到非 ASCII 就放弃。）
fn split_of(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0;
    while i + 2 <= b.len() {
        let is_of = b[i].eq_ignore_ascii_case(&b'o') && b[i + 1].eq_ignore_ascii_case(&b'f');
        if is_of {
            let before_ok = i == 0 || !b[i - 1].is_ascii_alphanumeric();
            let after_ok = i + 2 >= b.len() || !b[i + 2].is_ascii_alphanumeric();
            if before_ok && after_ok {
                let seg = s[start..i].trim();
                if !seg.is_empty() {
                    out.push(seg);
                }
                start = i + 2;
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    let tail = s[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    if out.is_empty() {
        vec![s]
    } else {
        out
    }
}

fn translate_flat(s: &str, kept: &mut usize) -> String {
    let words = tokenize(s);
    // (译文, 该词前面原句有没有空格)
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let w = &words[i];

        if w.punct {
            out.push((cn_punct_at(&words, i).to_string(), w.space));
            i += 1;
            continue;
        }

        // 最长匹配：4 → 1。只在连续、非标点、非代码的词上做，
        // 否则 `list of` 会被当成短语吃掉。
        let mut hit: Option<(usize, &'static str)> = None;
        for n in (1..=4).rev() {
            if i + n > words.len() {
                continue;
            }
            let win = &words[i..i + n];
            if win.iter().any(|x| x.punct || x.code) {
                continue;
            }
            let joined = win
                .iter()
                .map(|x| x.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            if let Some(v) = phrase_map().get(joined.as_str()) {
                hit = Some((n, v));
                break;
            }
        }
        if let Some((n, zh)) = hit {
            // `built in Rust` 不是「内置 Rust」，是「用 Rust 写的」。
            // 静态词表没法带条件，这种要看后一个词才能定性的短语只能在这儿兜。
            let zh = if zh == "内置" && words.get(i + n).map(|w| is_lang(&w.text)).unwrap_or(false) {
                "基于"
            } else {
                zh
            };
            if !zh.is_empty() {
                out.push((zh.to_string(), w.space));
            }
            i += n;
            continue;
        }

        if w.code {
            out.push((w.text.clone(), w.space));
            i += 1;
            continue;
        }
        if keep_set().contains(w.text.to_lowercase().as_str()) {
            out.push((w.text.clone(), w.space));
            i += 1;
            continue;
        }
        match lookup(&w.text) {
            Some(zh) => {
                if !zh.is_empty() {
                    out.push((zh.to_string(), w.space));
                }
            }
            None => {
                *kept += 1;
                out.push((w.text.clone(), w.space));
            }
        }
        i += 1;
    }
    join_words(&out)
}

struct Word {
    text: String,
    code: bool,
    punct: bool,
    /// 原句里这个词前面有没有空格。拼装时按它决定要不要补空格，
    /// 否则 `# Deno` 会变成 `#Deno`，markdown 标题就废了。
    space: bool,
}

/// 分词。标点单独成词保留下来——技术文本里 `,` 和 `(` 承载的信息
/// 不比单词少，丢掉它们译文会变成一坨没有停顿的字。
///
/// 点号要区分两种情况：`3.5` `freeCodeCamp.org` `package.json` 里的点是词内点，
/// 句末的 `.` 才是标点。判断依据是它后面还跟不跟字母数字。
fn tokenize(s: &str) -> Vec<Word> {
    let ch: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    // 当前 cur 前面有没有空格；pending 是「上一个词之后出现过空白」
    let mut cur_space = false;
    let mut pending = false;
    let mut i = 0;
    while i < ch.len() {
        let c = ch[i];

        if c == '.' {
            let next_joins = ch
                .get(i + 1)
                .map(|x| x.is_ascii_alphanumeric() || *x == '_' || *x == '-')
                .unwrap_or(false);
            if next_joins && !cur.is_empty() {
                cur.push('.');
            } else {
                flush(&mut out, &mut cur, &mut cur_space);
                out.push(Word {
                    text: ".".into(),
                    code: false,
                    punct: true,
                    space: std::mem::take(&mut pending),
                });
            }
            i += 1;
            continue;
        }

        if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '\'' || c == '/' {
            if cur.is_empty() {
                cur_space = std::mem::take(&mut pending);
            }
            cur.push(c);
        } else if c == '&' {
            // HTML 实体必须整块保住：`&amp;` 被拆成 `&amp` + `;` 之后，
            // 分号会被换成全角「；」，实体就废了，页面上平白多一个分号。
            let mut j = i + 1;
            while j < ch.len() && j - i <= 10 && (ch[j].is_ascii_alphanumeric() || ch[j] == '#') {
                j += 1;
            }
            if j > i + 1 && j < ch.len() && ch[j] == ';' {
                flush(&mut out, &mut cur, &mut cur_space);
                out.push(Word {
                    text: ch[i..=j].iter().collect(),
                    code: true,
                    punct: false,
                    space: std::mem::take(&mut pending),
                });
                i = j + 1;
                continue;
            }
            flush(&mut out, &mut cur, &mut cur_space);
            out.push(Word {
                text: c.to_string(),
                code: false,
                punct: true,
                space: std::mem::take(&mut pending),
            });
        } else if c.is_ascii_punctuation() {
            flush(&mut out, &mut cur, &mut cur_space);
            out.push(Word {
                text: c.to_string(),
                code: false,
                punct: true,
                space: std::mem::take(&mut pending),
            });
        } else if c.is_whitespace() {
            flush(&mut out, &mut cur, &mut cur_space);
            pending = true;
        } else {
            // 中文、日文、emoji：原样留着，不参与翻译
            flush(&mut out, &mut cur, &mut cur_space);
            out.push(Word {
                text: c.to_string(),
                code: true,
                punct: false,
                space: std::mem::take(&mut pending),
            });
        }
        i += 1;
    }
    flush(&mut out, &mut cur, &mut cur_space);
    out
}

fn flush(out: &mut Vec<Word>, cur: &mut String, space: &mut bool) {
    if cur.is_empty() {
        return;
    }
    let t = std::mem::take(cur);
    let code = is_code_token(&t);
    out.push(Word { text: t, code, punct: false, space: std::mem::take(space) });
}

/// 标点换全角，但有三个地方不能动：
/// - 有序列表的「1.」，换成句号列表就断了；
/// - 图片语法「![]()」，感叹号换全角图片就没了；
/// - 冒号一律保留，`[x]: url` 这种引用定义、`12:30` 这种时间都经不起全角。
fn cn_punct_at<'a>(words: &'a [Word], i: usize) -> &'a str {
    let p = words[i].text.as_str();
    let prev = if i > 0 { Some(words[i - 1].text.as_str()) } else { None };
    let next = words.get(i + 1).map(|w| w.text.as_str());
    match p {
        // 数字里的千分位不是标点：2,500 换成全角会变成 2，500，看着像小数
        "," => match (prev, next) {
            (Some(a), Some(b))
                if a.chars().last().map(|c| c.is_ascii_digit()).unwrap_or(false)
                    && b.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) =>
            {
                ","
            }
            _ => "，",
        },
        ";" => "；",
        "?" => "？",
        "." => match prev {
            Some(t) if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) => ".",
            _ => "。",
        },
        "!" => {
            if next == Some("[") {
                "!"
            } else {
                "！"
            }
        }
        _ => p,
    }
}

/// 拼装。中文不加空格；两个非中文的残留词之间，按原句的空格补一个。
/// 只看「原句有没有空格」而不是「两边是不是字母」，是为了保住
/// `# Deno` 这种标题语法——`#` 和 `Deno` 之间的空格一旦吞掉，
/// 整行就从标题降级成正文。
fn join_words(parts: &[(String, bool)]) -> String {
    let mut out = String::new();
    for (p, space) in parts {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        let first = p.chars().next().unwrap();
        let prev = out.chars().last();
        // `#` `>` `|` 是 markdown 的结构符，后面那个空格是语法的一部分，
        // 哪怕后面接的是中文也得留着，否则「## 安装」会塌成「##安装」。
        let structural = *space
            && prev
                .map(|c| matches!(c, '#' | '>' | '|' | '-' | '*'))
                .unwrap_or(false);
        let need = *space
            && (structural
                || (prev.map(|c| !is_cn(c) && !c.is_whitespace()).unwrap_or(false)
                    && !is_cn(first)));
        if need {
            out.push(' ');
        }
        out.push_str(p);
    }
    out
}

fn is_cn(c: char) -> bool {
    matches!(c,
        '\u{3000}'..='\u{303f}'   // 中文标点
        | '\u{4e00}'..='\u{9fff}' // 汉字
        | '\u{ff00}'..='\u{ffef}' // 全角
    )
}

/// 遮罩：行内代码、链接目标、裸 URL。
/// 这三样一个字符都不能动——`https://` 的冒号被换成全角，链接就死了；
/// `` `npm run dev` `` 被逐词翻掉，命令就没法照抄了。
/// 用 ⟦n⟧ 占位：`⟦` 是非 ASCII，分词时会当成代码词整块留下，不会被拆。
fn mask_code(s: &str) -> (String, Vec<String>) {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut hold: Vec<String> = Vec::new();
    let mut i = 0;
    while i < b.len() {
        // 行内代码 `...`
        if b[i] == '`' {
            let mut j = i + 1;
            while j < b.len() && b[j] != '`' && b[j] != '\n' {
                j += 1;
            }
            if j < b.len() && b[j] == '`' {
                hold.push(b[i..=j].iter().collect());
                out.push_str(&format!("⟦c{}⟧", hold.len() - 1));
                i = j + 1;
                continue;
            }
        }
        // 链接目标 ](...)：相对路径 ./docs/x.md、锚点 #foo 都在这儿
        if b[i] == ']' && b.get(i + 1) == Some(&'(') {
            let mut depth = 0i32;
            let mut j = i + 1;
            let mut end = None;
            while j < b.len() {
                match b[j] {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(j);
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            if let Some(e) = end {
                hold.push(b[i..=e].iter().collect());
                out.push_str(&format!("⟦c{}⟧", hold.len() - 1));
                i = e + 1;
                continue;
            }
        }
        // 裸 URL
        if (b[i] == 'h' || b[i] == 'H') && starts_ci(&b[i..], "http") {
            let mut j = i;
            while j < b.len() && !is_url_end(b[j]) {
                j += 1;
            }
            // 尾巴上的句读是句子的一部分，不属于 URL
            while j > i && matches!(b[j - 1], '.' | ',' | ';' | ':' | '!' | '?') {
                j -= 1;
            }
            if j > i + 4 {
                hold.push(b[i..j].iter().collect());
                out.push_str(&format!("⟦c{}⟧", hold.len() - 1));
                i = j;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    (out, hold)
}

fn starts_ci(b: &[char], pat: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    b.len() >= p.len() && b[..p.len()].iter().zip(p.iter()).all(|(x, y)| x.eq_ignore_ascii_case(y))
}

fn is_url_end(c: char) -> bool {
    c.is_whitespace() || matches!(c, ')' | ']' | '>' | '"' | '`' | '<' | '|' | '⟦' | '⟧')
}

fn unmask_code(s: &str, hold: &[String]) -> String {
    if hold.is_empty() {
        return s.to_string();
    }
    let ch: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < ch.len() {
        // 只认自己的 `⟦c` 前缀：图片遮罩用的是 `⟦n⟧`，两套编号各从 0 起，
        // 不加前缀会互相顶掉——实测把 `[![](a)](b)` 还原成了 `[](b)](b)`。
        if ch[i] == '⟦' && ch.get(i + 1) == Some(&'c') {
            let mut j = i + 2;
            let mut n = String::new();
            while j < ch.len() && ch[j].is_ascii_digit() {
                n.push(ch[j]);
                j += 1;
            }
            if !n.is_empty() && j < ch.len() && ch[j] == '⟧' {
                if let Ok(k) = n.parse::<usize>() {
                    if k < hold.len() {
                        out.push_str(&hold[k]);
                        i = j + 1;
                        continue;
                    }
                }
            }
        }
        out.push(ch[i]);
        i += 1;
    }
    out
}

/// 整段文本：按句切，逐句翻。句子边界保住了，译文才有节奏。
pub fn paragraph(text: &str) -> Out {
    // 本来就是中文（或中文为主）的内容不碰，翻了反而丢字。
    let cjk = text
        .chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .count();
    let latin = text.chars().filter(|c| c.is_ascii_alphabetic()).count();
    if latin == 0 || cjk * 2 >= latin {
        return Out {
            text: text.to_string(),
            kept: 0,
        };
    }

    // 先把 URL / 行内代码 / 链接目标挖掉，翻完再填回去
    let (masked, hold) = mask_code(text);

    let mut out = String::new();
    let mut kept = 0;
    let mut buf = String::new();
    let ch: Vec<char> = masked.chars().collect();
    for (i, &c) in ch.iter().enumerate() {
        buf.push(c);
        // 域名和文件名里的点不是句号：freeCodeCamp.org 不能被切成两段
        let boundary = match c {
            '.' => {
                let joins = ch
                    .get(i + 1)
                    .map(|x| x.is_ascii_alphanumeric() || *x == '_' || *x == '-')
                    .unwrap_or(false);
                !joins
            }
            // 「![」是图片语法，不是感叹句，不能在这里断句
            '!' => ch.get(i + 1).map(|x| *x != '[').unwrap_or(true),
            '?' | '\n' => true,
            _ => false,
        };
        if boundary {
            let r = translate(&buf);
            out.push_str(&r.text);
            kept += r.kept;
            if c == '\n' {
                out.push('\n');
            }
            buf.clear();
        }
    }
    if !buf.trim().is_empty() {
        let r = translate(&buf);
        out.push_str(&r.text);
        kept += r.kept;
    }
    Out {
        text: unmask_code(&tidy(&out), &hold),
        kept,
    }
}

/// 一行带 HTML：标签原样留着，只有标签之间的文字去翻译。
/// 徽章墙那种整行都是标签的，等于原样返回——一个字节都不动。
///
/// `<` 后面必须是字母或 `/` 才算标签开头，否则 `a < b` 里的 `<`
/// 会把后面半行都当成标签属性吞掉。
pub fn html_line(line: &str) -> String {
    let ch: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut text = String::new();
    let mut in_tag = false;
    let mut i = 0;
    while i < ch.len() {
        let c = ch[i];
        if c == '<' && !in_tag {
            let opens_tag = ch
                .get(i + 1)
                .map(|n| n.is_ascii_alphabetic() || *n == '/' || *n == '!')
                .unwrap_or(false);
            if opens_tag {
                if !text.is_empty() {
                    out.push_str(&paragraph(&text).text);
                    text.clear();
                }
                in_tag = true;
                out.push(c);
                i += 1;
                continue;
            }
            text.push(c);
            i += 1;
            continue;
        }
        if in_tag {
            if c == '>' {
                in_tag = false;
            }
            out.push(c);
            i += 1;
            continue;
        }
        text.push(c);
        i += 1;
    }
    if !text.is_empty() {
        out.push_str(&paragraph(&text).text);
    }
    out
}

fn tidy(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev = '\0';
    for c in s.chars() {
        if c == ' ' {
            if prev == ' ' || prev == '\0' {
                continue;
            }
            if prev == '，' || prev == '。' || prev == '、' {
                continue;
            }
        }
        if c == '，' && (prev == '，' || prev == '。') {
            continue;
        }
        out.push(c);
        prev = c;
    }
    // 句号重复
    while out.contains("。。") {
        out = out.replace("。。", "。");
    }
    while out.contains("，。") {
        out = out.replace("，。", "。");
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> String {
        paragraph(s).text
    }

    #[test]
    fn platform_words_do_not_mean_literal_things() {
        // 用户点名的两条：win 不是胜利，window 不是窗户
        assert!(t("Runs on win.").contains("Windows"));
        assert!(!t("Runs on win.").contains("胜利"));
        assert!(t("Open a window.").contains("窗口"));
        assert!(!t("Open a window.").contains("窗户"));
    }

    #[test]
    fn git_words_keep_their_git_meaning() {
        let s = t("Commit to the branch and open a pull request.");
        assert!(s.contains("提交"), "{s}");
        assert!(s.contains("分支"), "{s}");
        assert!(s.contains("拉取请求"), "{s}");
        assert!(!s.contains("承诺"), "{s}");
        assert!(!s.contains("树枝"), "{s}");
    }

    #[test]
    fn of_reverses_the_order() {
        // A list of free APIs → 免费 API 的列表，而不是「列表的免费 API」
        let s = t("A list of free APIs.");
        let pos_api = s.find("API").unwrap_or(999);
        let pos_list = s.find("列表").unwrap_or(999);
        assert!(pos_api < pos_list, "语序没倒过来：{s}");
    }

    #[test]
    fn code_identifiers_survive_untouched() {
        let s = t("Call getUserById then npm install.");
        assert!(s.contains("getUserById"), "{s}");
        assert!(s.contains("npm"), "{s}");
    }

    /// 不是断言，是用真实描述人肉看效果：
    /// `cargo test -p flow-core preview -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn preview() {
        let sample = [
            "A collective list of free APIs",
            "freeCodeCamp.org's open-source codebase and curriculum. Learn math, programming, and computer science for free.",
            "Reverse engineer anything with agents, from app behavior down to native binaries",
            "Freely available programming books",
            "The AI that really does things. Any OS. Any Platform.",
            "Learn how to design large-scale systems. Prep for the system design interview.",
            "Interactive roadmaps, guides and other educational content to help developers grow.",
            "The definitive list that answers: which tool should I use?",
            "A fast, lightweight web framework for building APIs with Rust.",
            "Cross-platform desktop app built with Tauri. Supports win, mac and linux.",
            "Commit your changes to the branch before you open a pull request.",
            "This window shows the memory usage of each process.",
            "High-performance key-value store with support for transactions.",
            "A simple CLI tool that helps you manage multiple git repositories at once.",
        ];
        for s in sample {
            let o = paragraph(s);
            println!("EN  {s}");
            println!("ZH  {}   （未译 {} 词）\n", o.text, o.kept);
        }
    }

    /// 全量体检：拿真实种子库跑一遍，看未译率和耗时。
    /// `FLOW_DB=app/seed.db cargo test -p flow-core bench_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_real() {
        let path = std::env::var("FLOW_DB").unwrap_or_else(|_| "app/seed.db".into());
        let conn = match rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(e) => {
                println!("打不开 {path}: {e}");
                return;
            }
        };
        let mut st = conn
            .prepare("select full_name, description from repo where description <> ''")
            .unwrap();
        let rows: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        let t0 = std::time::Instant::now();
        let mut src_chars = 0usize;
        let mut out_chars = 0usize;
        let mut kept = 0usize;
        let mut words = 0usize;
        let mut samples: Vec<(String, String, String)> = Vec::new();
        for (name, desc) in &rows {
            let o = paragraph(desc);
            src_chars += desc.chars().count();
            out_chars += o.text.chars().count();
            kept += o.kept;
            words += desc.split_whitespace().count();
            if samples.len() < 200 {
                samples.push((name.clone(), desc.clone(), o.text));
            }
        }
        let ms = t0.elapsed().as_millis();

        println!("\n条目 {} 条，耗时 {} ms（平均 {:.2} ms/条）", rows.len(), ms, ms as f64 / rows.len() as f64);
        println!(
            "未译 {kept} 词 / 共 {words} 词 = {:.1}%",
            kept as f64 * 100.0 / words as f64
        );
        println!(
            "字符 {} → {}（中文比英文短 {:.0}%）",
            src_chars,
            out_chars,
            (1.0 - out_chars as f64 / src_chars as f64) * 100.0
        );

        println!("\n── 随机 24 条对照 ──");
        let step = (samples.len() / 24).max(1);
        for (name, en, zh) in samples.iter().step_by(step).take(24) {
            println!("{name}");
            println!("  EN {en}");
            println!("  ZH {zh}");
        }
    }

    /// 找出真正的漏词：小写开头的未译词按频次排序。
    /// 大写开头的多半是项目名/库名，本来就该留英文，不算漏。
    #[test]
    #[ignore]
    fn missed_words() {
        let path = std::env::var("FLOW_DB").unwrap_or_else(|_| "app/seed.db".into());
        let conn = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let mut st = conn
            .prepare("select description || ' ' || readme_head from repo where description <> '' or readme_head <> ''")
            .unwrap();
        let rows: Vec<String> = st
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        let mut freq: HashMap<String, usize> = HashMap::new();
        for desc in &rows {
            for w in desc.split_whitespace() {
                let clean: String = w
                    .chars()
                    .filter(|c| c.is_ascii_alphabetic() || *c == '-')
                    .collect();
                if clean.len() < 3 {
                    continue;
                }
                let first = clean.chars().next().unwrap();
                if !first.is_ascii_lowercase() {
                    continue;
                }
                if lookup(&clean).is_none()
                    && lookup(&clean.to_lowercase()).is_none()
                    && !phrase_map().contains_key(clean.to_lowercase().as_str())
                {
                    *freq.entry(clean.to_lowercase()).or_insert(0) += 1;
                }
            }
        }
        let mut v: Vec<(String, usize)> = freq.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        println!("\n── 漏词 top 200（小写开头，出现 8 次以上）──");
        let mut line = String::new();
        let mut n = 0;
        for (w, c) in v.iter().filter(|(_, c)| *c >= 8).take(200) {
            line.push_str(&format!("{w}({c}) "));
            n += 1;
            if n % 8 == 0 {
                println!("{line}");
                line.clear();
            }
        }
        if !line.is_empty() {
            println!("{line}");
        }
    }
    #[test]
    fn bang_before_bracket_stays_ascii() {
        let o = paragraph("[![Twitter badge][]][Twitter link]");
        println!("{}", o.text);
        assert!(o.text.contains("[!["), "感叹号不该变全角: {}", o.text);
    }

    #[test]
    fn urls_survive() {
        let o = paragraph("See [docs](https://deno.com/a?b=1) and https://x.dev/y.");
        println!("{}", o.text);
        assert!(o.text.contains("https://deno.com/a?b=1"), "{}", o.text);
        assert!(o.text.contains("https://x.dev/y"), "{}", o.text);
    }
    #[test]
    fn built_in_is_not_always_builtin() {
        // 「用某语言写的」是 README 里的常见意思，不能一律译成「内置」
        let a = translate("A game engine built in Rust.").text;
        assert!(a.contains("基于Rust"), "{a}");
        assert!(!a.contains("内置"), "{a}");
        // 带连字符的 built-in 是另一个词，仍然是「内置」
        let b = translate("A browser with a built-in ad blocker.").text;
        assert!(b.contains("内置"), "{b}");
    }

}
