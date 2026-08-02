//! v4.0 Usage 模块入口
//!
//! 6 IPC: usage_summary / get_session_cost / get_session_timeline /
//! get_project_breakdown / get_daily_breakdown / get_top_tools。

pub mod types;
pub mod scanner;

#[cfg(test)]
mod tests;

pub use scanner::{
    estimate_tokens, get_daily_breakdown, get_project_breakdown, get_session_cost,
    get_session_timeline, get_top_tools, usage_summary,
};
pub use types::{
    SessionCost, SessionTimeline, SessionTimelineEntry, UsageByDayRow, UsageByProjectRow,
    UsageByToolRow, UsageSummary,
};
