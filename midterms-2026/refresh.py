import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

URL = 'https://www.foxnews.com/elections'
sources = {'senate': URL, 'house': URL + '/2026/midterm-results/house'}
states = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'
codes = dict(zip(states.split('|'), 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()))

def parse(page, chamber):
    stamp = re.search(r'Last Updated: <time[^>]*datetime="([^"]+)"', page)[1]
    assert stamp[:10] == '2026-11-04'
    totals = [int(re.search(r'bd__count--' + side + '-' + chamber + r'[^>]*>\s*(?:<!---->\s*)?<span>(\d+)</span>', page)[1]) for side in ('left', 'right')]
    calls = {}
    pattern = r'<li class="(dem|rep) [^"]*race-calls__item"[^>]*>.*?race-calls__call">(?:AP|Fox News) calls (.*?) (?:District (\d+)|Class (\d+) Seat) for ([^<]+)</p>'
    for party, state, district, senate_class, name in re.findall(pattern, page, re.S):
        if state not in codes or bool(district) != (chamber == 'house'):
            continue
        code = codes[state]
        key = code + '-' + (district.zfill(2) if district else senate_class)
        calls.setdefault(key, [code, 'D' if party == 'dem' else 'R', html.unescape(name).removesuffix('.')])
    remaining = (435 if chamber == 'house' else 100) - sum(totals)
    assert 0 <= remaining and len(calls) >= (250 if chamber == 'house' else 20)
    assert all(sum(row[1] == party for row in calls.values()) <= total for party, total in zip('DR', totals))
    return dict(stamp=stamp, totals=totals, remaining=remaining, calls=calls)

def snapshot():
    result = {}
    for chamber, url in sources.items():
        with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as response:
            result[chamber] = parse(response.read().decode(), chamber)
    return result

if __name__ == '__main__':
    path = Path('midterms-2026/results.json')
    fresh = snapshot()
    if path.exists():
        previous = json.loads(path.read_text())
        for chamber in sources:
            assert fresh[chamber]['stamp'] >= previous[chamber]['stamp']
            assert previous[chamber]['calls'].keys() <= fresh[chamber]['calls'].keys()
    path.write_text(json.dumps(fresh, ensure_ascii=False, sort_keys=True) + '\n')
