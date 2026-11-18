"""Fetch INSP SitRep PDFs and parse cumulative confirmed cases per health zone.

Source: Institut National de Sante Publique, RDC - https://insp.cd/
Each daily SitRep post embeds a PDF. Table 2 gives cumulative confirmed cases
and deaths by province and health zone. Only that table is parsed: the later
tables (alerts, contact tracing, points of entry) also carry province rows
ending in a percentage and would otherwise be mixed in.
"""
import base64, io, json, re, sys, unicodedata, urllib.parse, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (compatible; research-client)'}
PROVINCES = ['Ituri', 'Nord-Kivu', 'Haut-Uele', 'Tshopo', 'Sud-Kivu',
             'Bas-Uele', 'Sud Ubangi', 'Nord Ubangi']

def norm(s):
    """Fold accents and unify separators: 'Bas Uélé' and 'Bas-Uele' are one."""
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[\s\-]+', '-', s.strip()).title()

PROV_N = {norm(p) for p in PROVINCES}

def get(url, binary=False):
    # Older uploads carry non-ASCII in the filename ("N°"), which urllib
    # cannot put in a request line; quote all but the URL delimiters.
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%~")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read() if binary else r.read().decode('utf-8', 'replace')

def list_sitreps(per_page=50, page=1):
    return json.loads(get('https://insp.cd/wp-json/wp/v2/posts?search=SitRep'
                          f'&per_page={per_page}&page={page}&_fields=link,title,date'))

def pdf_url(post_url):
    m = re.search(r'pdfemb-data=([A-Za-z0-9_-]+)', get(post_url))
    if not m: return None
    raw = m.group(1).replace('-', '+').replace('_', '/')
    return json.loads(base64.b64decode(raw + '=' * (-len(raw) % 4)))['url']

# Two layouts over the outbreak: the current one heads Table 2 with
# "Cas (n) Deces (n) Letalite", the early one with a wrapped header ending
# "Letalite (CFR %)". Anchor on either.
T2_START = re.compile(r'Cas\s*\(n\)\s*D[ée]c[èe]s\s*\(n\)\s*L[ée]talit[ée]'
                      r'|L[ée]talit[ée]\s*\(\s*CFR[,\s]*%?\s*\)')
T2_END   = re.compile(r'Tableau\s*3|Situation des alertes|Figure\s*2')
# A row is "<name> <cases> <deaths> <cfr>%". Thousands separators vary -
# none, a narrow no-break space, or a plain space - so "Ituri 2 988 1 238
# 41,40%" must read 2988 and 1238, while "Bunia 950 289 30,4%" must stay 950
# and 289. Joining digits on sight cannot tell those apart, so anchor on the
# percentage, take the numeric run before it, and merge 3-digit groups left
# to right until exactly the two expected values remain.
PCT = re.compile(r'^(.*?)\s+([\d,.]+)\s*%')


def parse_row(line):
    m = PCT.match(line)
    if not m:
        return None
    toks = m.group(1).split()
    nums = []
    while toks and re.fullmatch(r'\d{1,6}', toks[-1]):
        nums.insert(0, toks.pop())
    if len(nums) < 2:
        return None
    while len(nums) > 2:
        for i in range(1, len(nums)):
            if len(nums[i]) == 3 and len(nums[i - 1]) <= 3:
                nums[i - 1:i + 1] = [nums[i - 1] + nums[i]]
                break
        else:
            return None
    name = ' '.join(toks).strip(' .:')
    if not name or not re.match(r'[A-Za-zÀ-ÿ]', name):
        return None
    return name, int(nums[0]), int(nums[1])


def _reflow(body):
    """Rejoin rows split across lines.

    Long zone names wrap ("Boma \\nMangbetu", "Makiso-\\nKisangani"), and bare
    page numbers are interleaved with the table. Carry any line without a
    complete row onto the next one so the name survives intact.

    Carrying only starts at the first complete row. The column header is also
    several lines without digits, and carrying it would glue "Total deces
    confirmes" onto the first province row - which then reads as the table's
    Total line and loses that province entirely.
    """
    out, carry, started = [], '', False
    for line in body.split('\n'):
        line = line.strip()
        if not line or re.fullmatch(r'\d{1,3}', line):   # page number
            continue
        if not started:
            if parse_row(line):
                started = True
                out.append(line)
            continue
        cand = (carry + ' ' + line).strip() if carry else line
        if parse_row(cand):
            out.append(cand); carry = ''
        elif re.search(r'\d', line) and not carry:
            out.append(line); carry = ''
        else:
            carry = cand if len(cand) < 60 else ''
    return out


def parse(pdf_bytes):
    import pypdf
    text = '\n'.join((p.extract_text() or '')
                     for p in pypdf.PdfReader(io.BytesIO(pdf_bytes)).pages)
    # Narrow/no-break spaces are used as thousands separators in some
    # reports. Left in, "3<U+202F>460" parses as the two numbers 3 and 460 and
    # the row silently reads wrong. Only these characters are joined, and
    # only before exactly three digits, so a real column break is untouched.
    text = re.sub(r'(?<=\d)[\u202f\u00a0\u2009\u2007](?=\d{3}(?!\d))', '', text)
    # Footnote markers attach to both names and figures ("Nord-Kivu* 325
    # 223*"), which stops the name matching a province and breaks the
    # numeric run. They carry no data, so drop them.
    text = re.sub(r'(?<=[\w\)])[*\u2020\u2021\u00b9\u00b2\u00b3]+', '', text)
    # A row's trailing percentage sometimes wraps to its own line
    # ("NORD-KIVU 144 81 56,3" / "%"). Rejoin just that, rather than
    # carrying whole lines, which merged genuine rows together.
    text = re.sub(r'([\d,]+)[ \t]*\n[ \t]*%', r'\1%', text)
    out = {'sitrep': None, 'report_date': None, 'provinces': {}, 'zones': {},
           'zone_province': {}, 'total_cases': None, 'total_deaths': None}
    d = re.search(r'SitRep\s*N°?\s*(\d+)\s*[/_ ]\s*MV[EB][^\d]{0,12}'
                  r'(\d{2})[/_-](\d{2})[/_-](\d{4})', text)
    if d:
        out['sitrep'] = int(d.group(1))
        out['report_date'] = f'{d.group(4)}-{d.group(3)}-{d.group(2)}'
    s0 = T2_START.search(text)
    if not s0: return out
    body = text[s0.end():]
    e0 = T2_END.search(body)
    if e0: body = body[:e0.start()]

    province = None
    for line in _reflow(body):
        r = parse_row(line)
        if not r: continue
        name, cases, deaths = r
        name = re.sub(r'\s+', ' ', name)
        n = norm(name)
        if n.lower().startswith('total'):
            out['total_cases'], out['total_deaths'] = cases, deaths
            break
        # A province name can also be a health zone inside that province
        # (Tshopo). The province row comes first, so never overwrite it.
        if n in PROV_N and n not in out['provinces']:
            province = n
            out['provinces'][n] = {'cases': cases, 'deaths': deaths}
        else:
            out['zones'][name] = {'cases': cases, 'deaths': deaths}
            out['zone_province'][name] = province
    return out

def fetch(post_url):
    return parse(get(pdf_url(post_url), binary=True))

DATA = 'insp_case_counts.json'


def reconciles(r):
    """A report is only used if its own arithmetic checks out.

    Every province subtotal must equal the sum of its health zones, and the
    provinces must sum to the Total row. A SitRep whose layout this parser
    reads wrongly fails here rather than publishing a wrong denominator.
    """
    if not (r['report_date'] and r['total_cases'] and r['provinces']):
        return False, 'no data parsed'
    for p, v in r['provinces'].items():
        z = sum(c['cases'] for k, c in r['zones'].items()
                if r['zone_province'].get(k) == p)
        if z != v['cases']:
            return False, f'{p}: zones {z} != stated {v["cases"]}'
    tot = sum(v['cases'] for v in r['provinces'].values())
    if tot != r['total_cases']:
        return False, f'provinces {tot} != total {r["total_cases"]}'
    return True, 'ok'


def build(every_days=7, limit=None, tries_per_period=5):
    """Record one reconciling report per period.

    The reports are published daily and the series only needs one a week, so
    a period that cannot be parsed is not a lost week: fall back to the
    neighbouring days until one reconciles. Taking a single report per
    period and giving up on failure left gaps wherever that particular
    report happened to use a layout the parser could not read.
    """
    import datetime
    try:
        old = json.load(open(DATA))
    except (OSError, ValueError):
        old = {'source': 'https://insp.cd/', 'series': [], 'latest': None}
    have = {e['date'] for e in old['series']}

    posts = []
    for page in range(1, 6):
        try:
            batch = list_sitreps(per_page=50, page=page)
        except Exception:
            break
        if not batch:
            break
        posts += [p for p in batch if '/sitrep-n' in p['link']]
    posts.sort(key=lambda p: p['date'], reverse=True)
    print(f'{len(posts)} SitRep posts indexed')
    if not posts:
        return 1

    # Bucket by period, newest first, so each bucket holds every report that
    # could stand for that period.
    newest = datetime.date.fromisoformat(posts[0]['date'][:10])
    buckets = {}
    for p in posts:
        d = datetime.date.fromisoformat(p['date'][:10])
        buckets.setdefault((newest - d).days // every_days, []).append(p)
    order = sorted(buckets)
    if limit:
        order = order[:limit]

    added = gaps = 0
    for b in order:
        attempts, recorded = 0, False
        for p in buckets[b]:
            if recorded or attempts >= tries_per_period:
                break
            try:
                r = fetch(p['link'])
            except Exception as e:
                attempts += 1
                print(f'    try {p["link"].rsplit("/", 2)[-2]}: {type(e).__name__}')
                continue
            if r['report_date'] in have:
                recorded = True
                break
            attempts += 1
            ok, why = reconciles(r)
            if not ok:
                print(f'    try SitRep {r["sitrep"]} ({r["report_date"]}): {why}')
                continue
            old['series'].append({'date': r['report_date'], 'sitrep': r['sitrep'],
                                  'cases': r['total_cases'],
                                  'deaths': r['total_deaths']})
            have.add(r['report_date'])
            added += 1
            recorded = True
            if old['latest'] is None or r['report_date'] >= old['latest']['date']:
                old['latest'] = {
                    'date': r['report_date'], 'sitrep': r['sitrep'],
                    'cases': r['total_cases'], 'deaths': r['total_deaths'],
                    'url': p['link'],
                    'zones': {k: v['cases'] for k, v in sorted(r['zones'].items())},
                }
            print(f'  SitRep {r["sitrep"]:>3} {r["report_date"]}  '
                  f'{r["total_cases"]:>6} cases'
                  + (f'  (after {attempts - 1} unreadable)' if attempts > 1 else ''))
        if not recorded:
            gaps += 1
            span = buckets[b][-1]['date'][:10] + '..' + buckets[b][0]['date'][:10]
            print(f'  GAP {span}: no report reconciled in {attempts} attempt(s)')

    old['series'].sort(key=lambda e: e['date'])
    old['fetched'] = __import__('datetime').datetime.now(
        __import__('datetime').timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump(old, open(DATA, 'w'), indent=1, ensure_ascii=False)
    open(DATA, 'a').write('\n')
    print(f'{DATA}: {len(old["series"])} reports '
          f'({added} new, {gaps} period(s) with no readable report)')
    return 0


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--every-days', type=int, default=7)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--tries-per-period', type=int, default=5,
                    help='how many neighbouring reports to try before '
                         'accepting that a period has none that reconcile')
    a = ap.parse_args()
    sys.exit(build(a.every_days, a.limit, a.tries_per_period))
