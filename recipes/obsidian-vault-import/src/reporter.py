"""
reporter.py — Markdown summary report generation.
"""

from datetime import datetime
from pathlib import Path


def write_report(thoughts: list, notes: list, vault_root: Path, recipe_dir: Path,
                 skip_reasons: dict, dry_run: bool = True,
                 inserted: int = 0, failures: int = 0):
    """Write a markdown summary report to recipe_dir/import-report.md."""
    report_path = recipe_dir / "import-report.md"
    lines = [
        "# Obsidian Import Report",
        "",
        f"- **Vault**: `{vault_root}`",
        f"- **Date**: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- **Mode**: {'Dry run' if dry_run else 'Live import'}",
        "",
        "## Summary",
        "",
        "| Metric | Count |",
        "|--------|-------|",
        f"| Notes scanned | {len(notes) + sum(skip_reasons.values())} |",
        f"| Notes filtered out | {sum(skip_reasons.values())} |",
        f"| Notes imported | {len(notes)} |",
        f"| Thoughts generated | {len(thoughts)} |",
    ]
    if not dry_run:
        lines.append(f"| Thoughts inserted | {inserted} |")
        lines.append(f"| Insert failures | {failures} |")

    lines += [
        "",
        "## Filter Breakdown",
        "",
    ]
    for reason, count in skip_reasons.items():
        if count:
            lines.append(f"- **{reason}**: {count}")

    lines += [
        "",
        "## Top Folders",
        "",
    ]
    folder_counts: dict[str, int] = {}
    for t in thoughts:
        folder = t['metadata']['folder'] or '(root)'
        folder_counts[folder] = folder_counts.get(folder, 0) + 1
    for folder, count in sorted(folder_counts.items(), key=lambda x: -x[1])[:10]:
        lines.append(f"- `{folder}`: {count} thoughts")

    report_path.write_text('\n'.join(lines) + '\n')
    print(f"  Report saved to {report_path}")
