"""Prepare and validate visual review for 77 production stage 7."""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile

from PIL import Image, ImageDraw, ImageOps


SCENE_NAME = re.compile(r"^(SC\d{3,})(?=$|[_.\-\s])", re.IGNORECASE)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
CHECKS = ("assets", "character", "anatomy", "composition")
VERDICTS = {"pass", "revise", "uncertain", "not_applicable"}
CLOSING_SECTIONS = {"outro", "closing", "마무리", "마무리 나레이션"}
DEFAULT_PLAN = "이미지폴더/제작자료/장면목록.json"
DEFAULT_ASSETS = "이미지폴더/에셋/참조에셋/에셋목록.json"
DEFAULT_OUTPUT = "이미지폴더/제작자료/7단계_이미지검수"


def inside(project, value):
    candidate = (project / value).resolve()
    if candidate != project and not candidate.is_relative_to(project):
        raise ValueError(f"프로젝트 밖의 경로입니다. {value}")
    return candidate


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def read_review_source(project, file):
    data = file.read_bytes()
    return json.loads(data.decode("utf-8-sig")), {
        "path": file.relative_to(project).as_posix(), "sha256": hashlib.sha256(data).hexdigest()
    }


def save_json(file, data):
    with NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=file.parent, delete=False
    ) as pending:
        temporary = Path(pending.name)
        try:
            json.dump(data, pending, ensure_ascii=False, indent=2)
            pending.write("\n")
        except BaseException:
            pending.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def as_items(value):
    if isinstance(value, list):
        return value
    return [value] if isinstance(value, (str, dict)) and value else []


def first(item, *keys):
    return next((item[key] for key in keys if item.get(key)), None)


def scene_key(value):
    match = SCENE_NAME.match(str(value or ""))
    return match[1].upper() if match else None


def scene_rows(plan, include_closing):
    rows = plan if isinstance(plan, list) else first(plan, "scenes", "sceneList")
    if not isinstance(rows, list) or not rows:
        raise ValueError("장면 목록 JSON의 scenes 또는 sceneList를 확인해 주세요.")
    rows = list(rows)
    if isinstance(plan, dict) and plan.get("separateClosingScene"):
        rows.append({**plan["separateClosingScene"], "section": "closing"})
    included, excluded = {}, []
    for row in rows:
        key = scene_key(first(row, "sceneId", "id", "scene", "number", "filename", "imageFile"))
        if not key:
            raise ValueError("SC 번호가 없는 장면이 있습니다.")
        section = str(row.get("section", "")).strip().lower()
        if not include_closing and section in CLOSING_SECTIONS:
            excluded.append(key)
        elif key in included:
            raise ValueError(f"장면 목록의 SC 번호가 중복됩니다. {key}")
        else:
            included[key] = row
    if not included:
        raise ValueError("검수할 본편 장면이 없습니다.")
    return included, excluded


def lookup_key(value):
    return value.strip().removeprefix("@").casefold() if isinstance(value, str) else ""


def asset_index(manifest):
    index, ambiguous = {}, set()
    for group in ("assets", "characters", "places", "props"):
        for item in as_items(manifest.get(group)):
            if not isinstance(item, dict):
                continue
            for field in ("id", "name", "alias", "mentionAlias", "registeredMention"):
                key = lookup_key(item.get(field))
                if not key:
                    continue
                prior = index.setdefault(key, item)
                if prior.get("id") != item.get("id"):
                    ambiguous.add(key)
    return {key: item for key, item in index.items() if key not in ambiguous}


def scene_references(row, index):
    known = {}
    for key, fallback_role in (("references", None), ("assets", "asset"), ("cast", "character"),
                               ("characters", "character")):
        for value in as_items(row.get(key)):
            ref = value if isinstance(value, dict) else {"name": value}
            identity = first(ref, "id", "name", "alias", "mention", "mentionAlias")
            value_key = lookup_key(identity)
            stored = index.get(value_key, {})
            asset_id = first(ref, "id") or stored.get("id") or identity or ""
            name = stored.get("name") or ref.get("name") or asset_id
            filename = (
                first(ref, "path", "relativePath", "file", "referencePath")
                or first(stored, "relativePath", "path", "file")
            )
            kind = first(ref, "kind") or stored.get("kind") or fallback_role
            if str(asset_id).upper().startswith("CHAR"):
                kind = "character"
            role = "character" if kind == "character" else "asset"
            item = {
                "id": asset_id, "name": name, "role": role, "path": filename,
                "state": ref.get("state") or stored.get("state"),
                "features": first(stored, "fixedFeatures", "features", "description"),
            }
            identity_key = lookup_key(asset_id) or str(filename)
            if identity_key not in known:
                known[identity_key] = item
            elif not known[identity_key]["path"] and item["path"]:
                known[identity_key] = item
    return list(known.values())


def inspect_image(project, file, limit):
    info = {"path": file.relative_to(project).as_posix()}
    try:
        data = file.read_bytes()
        with Image.open(BytesIO(data)) as source:
            if source.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("PNG·JPEG·WebP 파일이 아닙니다.")
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("정지 이미지 파일이 아닙니다.")
            image = ImageOps.exif_transpose(source).convert("RGB")
        info["width"], info["height"] = image.size
        info["sha256"] = hashlib.sha256(data).hexdigest()
        image.thumbnail(limit, Image.Resampling.LANCZOS)
        return info, image
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        return {**info, "error": str(error)}, None


def sheets(output, tiles, name, columns, rows, size):
    width, height = size
    batch_size = columns * rows
    results = []
    for offset in range(0, len(tiles), batch_size):
        batch = tiles[offset:offset + batch_size]
        board = Image.new("RGB", (columns * width, rows * (height + 26)), "#182029")
        draw = ImageDraw.Draw(board)
        for index, (label, image) in enumerate(batch):
            x, y = (index % columns) * width, (index // columns) * (height + 26)
            draw.text((x + 8, y + 7), label, fill="white")
            board.paste(image, (x + (width - image.width) // 2, y + 26))
        file = output / f"{name}_{offset // batch_size + 1:02}.jpg"
        board.save(file, quality=88, optimize=True)
        results.append({"file": file.name, "items": [label for label, _ in batch]})
    return results


def scene_images(directory):
    detected = {}
    for file in sorted(directory.iterdir()):
        key = scene_key(file.name)
        if key and file.suffix.lower() in IMAGE_EXTENSIONS and file.is_file():
            detected.setdefault(key, []).append(file)
    return detected


def prepare(project, output, args):
    plan_file = inside(project, args.scenes)
    plan, plan_info = read_review_source(project, plan_file)
    rows, excluded = scene_rows(plan, args.include_closing)
    asset_hint = plan.get("assetManifest") if isinstance(plan, dict) else None
    if isinstance(asset_hint, dict):
        asset_hint = first(asset_hint, "relativePath", "path", "file")
    asset_file = inside(project, args.assets or asset_hint or DEFAULT_ASSETS)
    use_assets = args.assets is not None or asset_hint or asset_file.is_file()
    approved_assets, asset_info = (
        read_review_source(project, asset_file) if use_assets else ({}, None)
    )
    approved_assets = asset_index(approved_assets)
    image_dir = inside(project, args.images)
    detected = scene_images(image_dir)

    references, scene_tiles, ref_tiles, scenes = {}, [], [], {}
    for key, row in rows.items():
        matches = detected.get(key, [])
        scene = {
            "title": row.get("title"), "place": row.get("place"),
            "event": first(row, "event", "purpose", "visual", "representativeFrame"),
            "shot": row.get("shot"), "blocking": first(row, "blocking", "placement"),
            "story": first(row, "narration", "visual", "representativeFrame"),
            "references": [], "fileIssues": [], "image": None,
        }
        if not matches:
            scene["fileIssues"].append("이미지 누락")
        elif len(matches) > 1:
            scene["fileIssues"].append("같은 SC 번호의 이미지가 여러 장 있음")
            scene["candidates"] = [file.relative_to(project).as_posix() for file in matches]
        else:
            scene["image"], thumb = inspect_image(project, inside(project, matches[0]), (752, 423))
            if thumb is None:
                scene["fileIssues"].append("손상되었거나 읽을 수 없는 이미지")
            else:
                scene_tiles.append((key, thumb))
                width, height = scene["image"]["width"], scene["image"]["height"]
                if abs((width / height) / (16 / 9) - 1) > .02:
                    scene["fileIssues"].append("16:9 구도 확인 필요")

        for ref in scene_references(row, approved_assets):
            filename = ref.pop("path")
            if filename:
                file = inside(project, filename)
                relative = file.relative_to(project).as_posix()
                if relative not in references:
                    label = f"R{len(references) + 1:03}"
                    info, thumb = inspect_image(project, file, (472, 290))
                    references[relative] = {"label": label, **info}
                    if thumb is not None:
                        ref_tiles.append((label, thumb))
                ref["image"] = references[relative]
            scene["references"].append(ref)
        scenes[key] = scene

    manifest = {
        "schemaVersion": 1,
        "plan": plan_info, "assetIndex": asset_info,
        "imageDirectory": image_dir.relative_to(project).as_posix(),
        "checks": list(CHECKS), "scenes": scenes, "excluded": excluded,
        "unexpectedFiles": [file.relative_to(project).as_posix() for key, files in detected.items()
                            if key not in scenes and key not in excluded for file in files],
        "sceneSheets": sheets(output, scene_tiles, "SC", 2, 2, (768, 430)),
        "referenceSheets": sheets(output, ref_tiles, "REF", 3, 3, (488, 296)),
    }
    save_json(output / "검수입력.json", manifest)
    return {"scenes": len(scenes), "sceneSheets": len(manifest["sceneSheets"]),
            "referenceSheets": len(manifest["referenceSheets"]), "output": str(output)}


def unchanged(project, item):
    if not item or not item.get("sha256"):
        return False
    try:
        return sha256(inside(project, item["path"])) == item["sha256"]
    except OSError:
        return False


def verdict(value):
    value = {"status": value} if isinstance(value, str) else value or {}
    status, note = value.get("status", "uncertain"), str(value.get("note") or "").strip()
    if status not in VERDICTS:
        raise ValueError(f"알 수 없는 판정입니다. {status}")
    if status == "revise" and not note:
        raise ValueError("수정 필요 판정에는 이미지에서 확인한 근거를 적어 주세요.")
    return {"status": status, "note": note}


def summarize(project, output, args):
    manifest = read_json(output / "검수입력.json")
    if not unchanged(project, manifest["plan"]) or (
        manifest.get("assetIndex") and not unchanged(project, manifest["assetIndex"])
    ):
        raise ValueError("장면 목록 또는 에셋 목록이 바뀌었습니다. 비교판을 다시 준비해 주세요.")
    findings = read_json(inside(project, args.findings)).get("scenes", {}) if args.findings else {}
    if set(findings) - set(manifest["scenes"]):
        raise ValueError("판정 파일에 검수 목록에 없는 SC 번호가 있습니다.")
    detected = scene_images(inside(project, manifest["imageDirectory"]))
    reference_status = {}
    report = {}
    for key, scene in manifest["scenes"].items():
        image_current = unchanged(project, scene["image"])
        file_issues = list(scene["fileIssues"])
        before = scene.get("candidates") or ([scene["image"]["path"]] if scene["image"] else [])
        current = [inside(project, file).relative_to(project).as_posix()
                   for file in detected.get(key, [])]
        if before != current or (scene["image"] and scene["image"].get("sha256") and not image_current):
            file_issues.append("비교판 준비 후 이미지가 바뀜")
            image_current = False
        blocked_roles = {}
        for ref in scene["references"]:
            image = ref.get("image")
            relative = image["path"] if image else None
            if relative and relative not in reference_status:
                reference_status[relative] = unchanged(project, image)
            if not reference_status.get(relative, False):
                blocked_roles.setdefault(ref["role"], []).append(ref["name"] or ref["id"] or "미지정")
        checks = {}
        for check in CHECKS:
            item = verdict(findings.get(key, {}).get(check)) if image_current else verdict(None)
            role = {"assets": "asset", "character": "character"}.get(check)
            if role in blocked_roles and item["status"] != "revise":
                names = ", ".join(map(str, blocked_roles[role]))
                item = {"status": "uncertain", "note": f"참조 파일이 없거나 비교판 준비 후 변경됨 ({names})"}
            elif item["status"] == "not_applicable" and (
                check == "composition" or any(ref["role"] == role for ref in scene["references"])
            ):
                item = {"status": "uncertain", "note": "장면의 배치 또는 지정된 참조를 확인해 주세요."}
            checks[check] = item
        statuses = {item["status"] for item in checks.values()}
        status = "revise" if file_issues or "revise" in statuses else (
            "uncertain" if "uncertain" in statuses else "pass"
        )
        report[key] = {"title": scene["title"], "image": scene["image"], "fileIssues": file_issues,
                       "checks": checks, "status": status}
    summary = {status: sum(row["status"] == status for row in report.values())
               for status in ("pass", "revise", "uncertain")}
    output_file = output / "검수결과.json"
    save_json(output_file, {"schemaVersion": 1, "summary": summary, "scenes": report,
                            "excluded": manifest["excluded"], "unexpectedFiles": manifest["unexpectedFiles"]})
    return {**summary, "report": str(output_file)}


def main():
    parser = argparse.ArgumentParser(description="77 7단계 장면 이미지 비교판과 검수 결과")
    subcommands = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "summarize"):
        sub = subcommands.add_parser(command)
        sub.add_argument("--project", required=True, type=Path)
        sub.add_argument("--output", default=DEFAULT_OUTPUT)
        if command == "prepare":
            sub.add_argument("--scenes", default=DEFAULT_PLAN)
            sub.add_argument("--assets")
            sub.add_argument("--images", default="이미지폴더/장면")
            sub.add_argument("--include-closing", action="store_true")
        else:
            sub.add_argument("--findings")
    args = parser.parse_args()
    try:
        project = args.project.resolve(strict=True)
        output = inside(project, args.output)
        if args.command == "prepare":
            output.mkdir(parents=True, exist_ok=True)
            result = prepare(project, output, args)
        else:
            result = summarize(project, output, args)
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, AttributeError, KeyError, TypeError) as error:
        print(f"검수 오류. {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
