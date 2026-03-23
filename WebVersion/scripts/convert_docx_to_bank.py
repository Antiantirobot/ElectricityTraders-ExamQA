import csv
import json
import re
from pathlib import Path

import docx

ROOT = Path(__file__).resolve().parents[1]
DOCX_FILES = [p for p in ROOT.glob('*.docx') if not p.name.startswith('~$')]
if not DOCX_FILES:
    raise SystemExit('未找到 docx 文件')
DOCX_PATH = DOCX_FILES[0]

OUT_CSV = ROOT / 'question_bank.csv'
OUT_JSON = ROOT / 'question_bank.json'
OUT_JS = ROOT / 'question_bank.js'

LEAD_MARKS = 'Oo0〇●◯○◎◇◆■□△▲▽▼※✦✧❍❖❶❷❸❹❺❻❼❽❾❿①②③④⑤⑥⑦⑧⑨⑩ⅡⅢⅣⅤⅥⅦⅧⅨⅩ゜'
QUESTION_RE = re.compile(rf'^\s*[\(\[【]?[{re.escape(LEAD_MARKS)}\s]*\s*(\d{{1,3}})\s*[\.．、]\s*(.*)$')
OPTION_RE = re.compile(r'^\s*([A-Ea-e])\s*[\.．、]\s*(.*)$')
CHAPTER_RE = re.compile(r'^\s*第[一二三四五六七八九十0-9]+章\s*.*$')
INLINE_Q_START_RE = re.compile(
    rf'(?:(?<=\s)|(?<=\))|(?<=）)|(?<=。)|(?<=；)|(?<=;))([{re.escape(LEAD_MARKS)}\s]{{0,3}}\d{{1,3}}[\.．、])'
)

CHAPTER_ALIAS = {
    '第八章 电力市场技术支持系统': '第八章 电力市场技术支持系统及应用',
    '第四章 电力现贷市场': '第四章 电力现货市场',
}

QUESTION_TYPE_SET = {'single', 'multiple', 'judge', 'blank', 'short', 'calc', 'essay'}


def clean(s: str) -> str:
    s = s.replace('\u3000', ' ').replace('\xa0', ' ')
    s = s.replace('’', "'").replace('“', '"').replace('”', '"')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def tidy_stem_text(s: str) -> str:
    s = clean(s)
    # 去掉题干尾部常见噪声：页码、孤立符号
    s = re.sub(r'\s+\d{1,3}$', '', s)
    s = re.sub(rf'[\s{re.escape(LEAD_MARKS)}]+$', '', s)
    return clean(s)


def normalize_chapter(ch: str) -> str:
    ch = clean(ch)
    return CHAPTER_ALIAS.get(ch, ch)


def normalize_answer_raw(s: str) -> str:
    s = clean(s)
    s = s.replace('【答案】', '').replace('答案', '')
    s = s.replace(':', '').replace('：', '').strip()
    return s


def section_to_type(section: str) -> str:
    t = section or ''
    if '判断' in t:
        return 'judge'
    if '填空' in t:
        return 'blank'
    if '简答' in t:
        return 'short'
    if '计算' in t:
        return 'calc'
    if '论述' in t:
        return 'essay'
    if '多选' in t:
        return 'multiple'
    if '不定项' in t:
        return 'choice'
    if '单选' in t or '单项' in t:
        return 'single'
    if '选择' in t:
        return 'choice'
    return 'unknown'


def normalize_answer(question_type: str, raw_answer: str):
    a = normalize_answer_raw(raw_answer)
    upper = re.sub(r'[^A-Za-z对错正确错误√×TtFf]', '', a).upper()

    if question_type == 'judge':
        if any(x in a for x in ['正确', '对', '√', 'T', 't']):
            if any(x in a for x in ['错误', '错', '×', 'F', 'f']):
                return a
            return '正确'
        if any(x in a for x in ['错误', '错', '×', 'F', 'f']):
            return '错误'
        return a

    if question_type in {'single', 'multiple', 'choice'}:
        letters = re.findall(r'[A-E]', upper)
        if letters:
            uniq = []
            for x in letters:
                if x not in uniq:
                    uniq.append(x)
            if question_type == 'single':
                return uniq[0]
            if question_type == 'multiple':
                return ''.join(uniq)
            return ''.join(uniq)
    return a


def split_inline_question_line(line: str):
    """把一行中嵌入的后续题号拆开，避免粘连多题。"""
    hits = [m.start(1) for m in INLINE_Q_START_RE.finditer(line)]
    if not hits:
        return [line]
    parts = []
    prev = 0
    for s in hits:
        if s > prev:
            parts.append(clean(line[prev:s]))
        prev = s
    parts.append(clean(line[prev:]))
    return [p for p in parts if p]


def is_section_header(line: str) -> bool:
    if '题' not in line:
        return False
    if line[:1] not in '一二三四五六七八九十':
        return False
    return any(x in line for x in ['选择题', '判断题', '填空题', '简答题', '计算题', '论述题'])


def infer_type_by_content(qtype: str, stem: str, options: dict, answer_raw: str):
    # 先处理 choice
    if qtype == 'choice':
        letters = re.findall(r'[A-E]', normalize_answer('choice', answer_raw).upper())
        qtype = 'multiple' if len(set(letters)) > 1 else 'single'

    # 内容兜底：答案是对/错 => 判断
    ans_guess = normalize_answer('judge', answer_raw)
    if qtype in {'unknown', 'short', 'blank'} and ans_guess in {'正确', '错误'}:
        return 'judge'

    # 有选项 + 选项答案 => 单/多选
    letters = re.findall(r'[A-E]', normalize_answer('choice', answer_raw).upper())
    if options and letters:
        if len(set(letters)) > 1:
            return 'multiple'
        return 'single'

    return qtype if qtype in QUESTION_TYPE_SET else 'short'


def finalize_question(q, out):
    if not q:
        return

    stem = tidy_stem_text(' '.join(q['stem_parts']))
    if not stem:
        return

    options = {}
    for key in ['A', 'B', 'C', 'D', 'E']:
        val = clean(q['options'].get(key, ''))
        if val:
            options[key] = val

    raw_answer = q.get('answer_raw', '')
    qtype = infer_type_by_content(q['question_type'], stem, options, raw_answer)
    answer = normalize_answer(qtype if qtype != 'unknown' else 'short', raw_answer)

    if qtype in {'single', 'multiple'} and not options:
        qtype = 'short'

    if qtype == 'multiple':
        answer_letters = re.findall(r'[A-E]', str(answer).upper())
        answer = ''.join(dict.fromkeys(answer_letters)) if answer_letters else clean(str(answer))
    elif qtype == 'single':
        m = re.search(r'[A-E]', str(answer).upper())
        answer = m.group(0) if m else clean(str(answer))
    elif qtype == 'judge':
        answer = normalize_answer('judge', raw_answer)
    else:
        answer = clean(str(answer))

    out.append({
        'id': '',
        'qno': q.get('qno', ''),
        'chapter': q['chapter'] or '未分类章节',
        'questionType': qtype,
        'stem': stem,
        'options': options,
        'correctAnswer': answer,
        'analysis': '暂无解析',
        'difficulty': '未设置',
        'source': DOCX_PATH.name,
        'isActive': True,
    })


def parse_lines(lines):
    questions = []
    current_chapter = '未分类章节'
    current_section = ''
    current = None
    last_option = None

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1

        # 跳过纯页码
        if re.fullmatch(r'\d{1,3}', line):
            continue

        # 拆开一行中潜在的多个题号起点
        split_parts = split_inline_question_line(line)
        if len(split_parts) > 1:
            # 当前处理第一段，其余插回队列
            line = split_parts[0]
            for extra in reversed(split_parts[1:]):
                lines.insert(i, extra)

        if CHAPTER_RE.match(line):
            current_chapter = normalize_chapter(line)
            continue

        if is_section_header(line):
            current_section = line
            continue

        if line.startswith('【答案】') or line.startswith('答案'):
            if current is not None:
                current['answer_raw'] = normalize_answer_raw(line)
            continue

        m_q = QUESTION_RE.match(line)
        if m_q:
            finalize_question(current, questions)
            stem_text = clean(m_q.group(2))
            current = {
                'qno': m_q.group(1),
                'chapter': current_chapter,
                'question_type': section_to_type(current_section),
                'stem_parts': [stem_text] if stem_text else [],
                'options': {},
                'answer_raw': ''
            }
            last_option = None
            continue

        m_opt = OPTION_RE.match(line)
        if m_opt and current is not None:
            key = m_opt.group(1).upper()
            val = clean(m_opt.group(2))
            current['options'][key] = val
            last_option = key
            continue

        if current is not None:
            if last_option and current['options'].get(last_option):
                current['options'][last_option] = clean(current['options'][last_option] + ' ' + line)
            else:
                current['stem_parts'].append(line)

    finalize_question(current, questions)
    for idx, q in enumerate(questions, 1):
        q['id'] = f'q_{idx:05d}'
    return questions


def write_outputs(questions):
    with OUT_CSV.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=['id', 'qno', 'chapter', 'questionType', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'correctAnswer', 'analysis', 'difficulty', 'source', 'isActive']
        )
        writer.writeheader()
        for q in questions:
            writer.writerow({
                'id': q['id'],
                'qno': q.get('qno', ''),
                'chapter': q['chapter'],
                'questionType': q['questionType'],
                'stem': q['stem'],
                'optionA': q['options'].get('A', ''),
                'optionB': q['options'].get('B', ''),
                'optionC': q['options'].get('C', ''),
                'optionD': q['options'].get('D', ''),
                'optionE': q['options'].get('E', ''),
                'correctAnswer': q['correctAnswer'],
                'analysis': q['analysis'],
                'difficulty': q['difficulty'],
                'source': q['source'],
                'isActive': 'true' if q['isActive'] else 'false'
            })

    with OUT_JSON.open('w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    js_obj = []
    for q in questions:
        ans = q['correctAnswer']
        if q['questionType'] == 'multiple':
            ans = list(dict.fromkeys(re.findall(r'[A-E]', str(ans).upper())))
        js_obj.append({
            'id': q['id'],
            'chapter': q['chapter'],
            'questionType': q['questionType'],
            'stem': q['stem'],
            'options': [q['options'].get('A', ''), q['options'].get('B', ''), q['options'].get('C', ''), q['options'].get('D', ''), q['options'].get('E', '')],
            'correctAnswer': ans,
            'analysis': q['analysis'],
            'difficulty': q['difficulty'],
            'source': q['source'],
            'isActive': q['isActive']
        })

    with OUT_JS.open('w', encoding='utf-8') as f:
        f.write('window.FULL_QUESTION_BANK = ')
        json.dump(js_obj, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')


def main():
    doc = docx.Document(str(DOCX_PATH))
    lines = []
    for p in doc.paragraphs:
        if not p.text:
            continue
        for ln in p.text.splitlines():
            ln = clean(ln)
            if ln:
                lines.append(ln)

    questions = parse_lines(lines)
    write_outputs(questions)

    by_type = {}
    by_chapter = {}
    for q in questions:
        by_type[q['questionType']] = by_type.get(q['questionType'], 0) + 1
        by_chapter[q['chapter']] = by_chapter.get(q['chapter'], 0) + 1

    print(f'docx: {DOCX_PATH.name}')
    print(f'questions: {len(questions)}')
    print('by_type:', json.dumps(by_type, ensure_ascii=False))
    print('chapters:', len(by_chapter))
    print(f'csv: {OUT_CSV.name}')
    print(f'json: {OUT_JSON.name}')
    print(f'js: {OUT_JS.name}')


if __name__ == '__main__':
    main()
