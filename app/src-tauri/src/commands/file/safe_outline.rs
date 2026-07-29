use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;

const MAX_SAFE_OUTLINE_HEADINGS: usize = 2_000;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SafeOutlineHeading {
    pub level: u8,
    pub text: String,
    pub anchor_text: String,
    pub id: String,
    pub utf16_offset: usize,
}

pub struct SafeOutline {
    pub headings: Vec<SafeOutlineHeading>,
    pub truncated: bool,
}

struct PendingHeading {
    level: u8,
    text: String,
    anchor_text: String,
    byte_offset: usize,
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn parser_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
}

pub fn extract_safe_outline(source: &str) -> SafeOutline {
    let mut pending = Vec::new();
    let mut current: Option<PendingHeading> = None;
    let mut image_depth = 0usize;
    let mut truncated = false;

    for (event, range) in Parser::new_ext(source, parser_options()).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                image_depth = 0;
                current = Some(PendingHeading {
                    level: heading_level(level),
                    text: String::new(),
                    anchor_text: String::new(),
                    byte_offset: range.start,
                });
            }
            Event::Start(Tag::Image { .. }) if current.is_some() => {
                image_depth += 1;
            }
            Event::End(TagEnd::Image) if current.is_some() => {
                image_depth = image_depth.saturating_sub(1);
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(mut heading) = current.take() {
                    heading.text = heading.text.trim().to_string();
                    heading.anchor_text = heading.anchor_text.trim().to_string();
                    if pending.len() >= MAX_SAFE_OUTLINE_HEADINGS {
                        truncated = true;
                        break;
                    }
                    pending.push(heading);
                }
            }
            Event::Text(text) if current.is_some() && image_depth == 0 => {
                let heading = current.as_mut().expect("checked above");
                heading.text.push_str(&text);
                heading.anchor_text.push_str(&text);
            }
            Event::Code(text) if current.is_some() && image_depth == 0 => {
                let heading = current.as_mut().expect("checked above");
                heading.text.push_str(&text);
                heading.anchor_text.extend(text.chars().filter(|character| {
                    character.is_alphanumeric() || character.is_whitespace() || *character == '-'
                }));
            }
            Event::SoftBreak | Event::HardBreak if current.is_some() => {
                let heading = current.as_mut().expect("checked above");
                heading.text.push(' ');
                heading.anchor_text.push(' ');
            }
            _ => {}
        }
    }

    let mut previous_byte_offset = 0;
    let mut utf16_offset = 0;
    let headings = pending
        .into_iter()
        .enumerate()
        .map(|(index, heading)| {
            utf16_offset += source[previous_byte_offset..heading.byte_offset]
                .encode_utf16()
                .count();
            previous_byte_offset = heading.byte_offset;
            SafeOutlineHeading {
                level: heading.level,
                text: heading.text,
                anchor_text: heading.anchor_text,
                id: format!("safe-heading-{}", index),
                utf16_offset,
            }
        })
        .collect();
    SafeOutline {
        headings,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_commonmark_headings_and_inline_text() {
        let outline = extract_safe_outline("# One *em*\n\nTwo\n===\n\n### `code`\n");
        assert_eq!(
            outline
                .headings
                .iter()
                .map(|heading| (heading.level, heading.text.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "One em"), (1, "Two"), (3, "code")]
        );
        assert!(!outline.truncated);
    }

    #[test]
    fn matches_rendered_text_for_images_and_keeps_empty_headings_for_anchor_order() {
        let outline = extract_safe_outline("# Hello ![alt](image.png)\n\n#\n\n## !!!\n");
        assert_eq!(
            outline
                .headings
                .iter()
                .map(|heading| heading.text.as_str())
                .collect::<Vec<_>>(),
            vec!["Hello", "", "!!!"]
        );
    }

    #[test]
    fn preserves_inline_code_structure_for_frontend_anchor_generation() {
        let outline =
            extract_safe_outline("# Win :trophy:\n\n## Code `:trophy:`\n\n### Literal `:D`\n");
        assert_eq!(outline.headings[0].anchor_text, "Win :trophy:");
        assert_eq!(outline.headings[1].text, "Code :trophy:");
        assert_eq!(outline.headings[1].anchor_text, "Code trophy");
        assert_eq!(outline.headings[2].text, "Literal :D");
        assert_eq!(outline.headings[2].anchor_text, "Literal D");
    }

    #[test]
    fn aligns_math_and_footnote_anchor_text_with_rendered_headings() {
        let outline = extract_safe_outline("# Value $x$\n\n## Heading[^n]\n\n[^n]: Note\n");
        assert_eq!(outline.headings[0].anchor_text, "Value $x$");
        assert_eq!(outline.headings[1].text, "Heading");
        assert_eq!(outline.headings[1].anchor_text, "Heading");
    }

    #[test]
    fn reports_javascript_utf16_offsets() {
        let source = "😀\n# Heading\n";
        let outline = extract_safe_outline(source);
        let heading = &outline.headings[0];
        assert_eq!(heading.utf16_offset, 3);
        assert_eq!(&source["😀\n".len()..], "# Heading\n");
    }

    #[test]
    fn caps_pathological_heading_counts() {
        let source = "# heading\n".repeat(MAX_SAFE_OUTLINE_HEADINGS + 10);
        let outline = extract_safe_outline(&source);
        assert_eq!(outline.headings.len(), MAX_SAFE_OUTLINE_HEADINGS);
        assert!(outline.truncated);
    }
}
