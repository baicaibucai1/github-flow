//! flow-core —— 与界面无关的全部逻辑。
//!
//! 三条硬规矩（写的时候就要守住，不是事后补）：
//!
//! 1. **一条数据通路**。界面拿到的项目一定来自这里的 [`store`]，
//!    拿不到就返回错误，永远不返回假数据。
//! 2. **不碰平台路径**。数据目录由外壳传进来（桌面 `%APPDATA%`、安卓私有目录），
//!    这个 crate 里出现 `HOME` / `LOCALAPPDATA` 就是错的。
//! 3. **打分是纯函数**。同样的输入必须给出同样的分数，否则没法测、没法解释。

pub mod model;
pub mod rank;
pub mod source;
pub mod store;

pub use model::Repo;
