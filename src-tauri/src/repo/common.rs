//! v4.0 repo 共享 utilities
//!
//! commit 26: parse_frontmatter_description — 4 模块 (skills / commands /
//! sub_agents / hooks) 的 .md / .md.frontmatter 解析 description 字段,
//! ProfileModuleItem 显示用。YAML frontmatter 简化解析(只取 description 一行),
//! 不依赖 serde_yaml(避免 +200KB)。

/// 简化 parser: 找文件首 `---` 块, 提 `description:` 一行 value。
/// 返回 None 如果没 frontmatter 或无 description 字段。
pub fn parse_frontmatter_description(content: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    // 找第二个 `---` 行
    let after_first = trimmed[3..].trim_start_matches('\n');
    let close_pos = after_first.find("\n---")?;
    let block = &after_first[..close_pos];
    for line in block.lines() {
        let line = line.trim();
        // 匹配 `description: <value>` 或 `description:<value>`
        if let Some(rest) = line.strip_prefix("description:") {
            let rest = rest.trim();
            if rest.is_empty() {
                continue;
            }
            // 如果 value 是 "..." 包裹, 去壳
            if (rest.starts_with('"') && rest.ends_with('"') && rest.len() >= 2)
                || (rest.starts_with('\'') && rest.ends_with('\'') && rest.len() >= 2)
            {
                return Some(rest[1..rest.len() - 1].to_string());
            }
            return Some(rest.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple() {
        let s = "---\ndescription: hello world\n---\nbody";
        assert_eq!(parse_frontmatter_description(s), Some("hello world".into()));
    }

    #[test]
    fn parse_quoted() {
        let s = "---\ndescription: \"quoted value\"\n---\n";
        assert_eq!(parse_frontmatter_description(s), Some("quoted value".into()));
    }

    #[test]
    fn parse_no_frontmatter() {
        assert_eq!(parse_frontmatter_description("plain text"), None);
    }

    #[test]
    fn parse_no_description() {
        let s = "---\nname: foo\n---\nbody";
        assert_eq!(parse_frontmatter_description(s), None);
    }
}
