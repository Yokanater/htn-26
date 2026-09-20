import { Armchair, LampDesk, Monitor, Shirt, ShoppingBag } from 'lucide-react';

export function SlotSymbol({ category, domain }: { category: string; domain: 'outfit' | 'setup' }) {
  const name = category.toLowerCase();
  if (/bottom|trouser|pant|legging|short|jean/.test(name)) {
    return (
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path
          d="M13 7h22l3 34H27l-3-22-3 22H10L13 7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M13 12h22M24 7v7" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  const Icon = /bag|tote|backpack/.test(name)
    ? ShoppingBag
    : /lamp|light/.test(name)
      ? LampDesk
      : /desk|monitor|screen/.test(name)
        ? Monitor
        : domain === 'setup'
          ? Armchair
          : Shirt;
  return <Icon />;
}

/** Local vector studies: illustrative inspiration, never product results. */
export function StudioArtwork({ domain = 'outfit' }: { domain?: 'outfit' | 'setup' }) {
  return (
    <svg className="studio-artwork" viewBox="0 0 360 300" fill="none" aria-hidden="true">
      {domain === 'outfit' ? (
        <>
          <ellipse cx="182" cy="267" rx="135" ry="13" fill="#293642" opacity=".07" />
          <path d="m200 112 70 3 10 143-36 2-17-100-8 100-36-2z" fill="#4c6270" />
          <path d="m226 132 1 26m-17-40 2 26m43-25-3 25" stroke="#344a58" strokeWidth="2" />
          <path
            d="m100 44-31 16-34 76 30 13 20-43-3 103 101 1-4-104 23 39 28-18-40-67-30-16c-17 16-42 17-60 0Z"
            fill="#a9bfc3"
            stroke="#819ca3"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="m101 44 10 21 24-10 21 11 6-22m-27 12-3 154m-42-95 27 1v25H90Zm60 1h25v25h-25"
            stroke="#738f97"
            strokeWidth="2"
          />
          <path d="m57 131 13 6m104 63-81-1" stroke="#cbdadd" strokeWidth="5" />
          <path
            d="m94 226 39 4 19 17 26 5c8 2 10 17-2 18l-84-2c-12 0-10-16-8-20Z"
            fill="#fcfcfa"
            stroke="#ccd1cf"
            strokeWidth="2"
          />
          <path d="m127 238 13-3m-5 10 13-3m-55 17 84 3" stroke="#b4bdba" strokeWidth="3" />
          <rect
            x="244"
            y="62"
            width="72"
            height="67"
            rx="12"
            fill="#c2af94"
            stroke="#a28e73"
            strokeWidth="2"
          />
          <path d="M260 64V53c0-22 40-22 40 0v11m-54 26h69" stroke="#a28e73" strokeWidth="4" />
        </>
      ) : (
        <>
          <path d="M28 258h302" stroke="#c6cec9" strokeWidth="2" />
          <rect
            x="43"
            y="45"
            width="111"
            height="102"
            rx="3"
            fill="#f8f8f4"
            stroke="#b2beb5"
            strokeWidth="5"
          />
          <circle cx="107" cy="86" r="22" fill="#d8c5a8" />
          <path d="m47 141 40-52 62 53" fill="#93aaa0" />
          <rect x="55" y="161" width="192" height="12" rx="4" fill="#ad8e70" />
          <path d="m67 172-8 85m175-85 8 85" stroke="#85745e" strokeWidth="7" />
          <rect x="97" y="108" width="85" height="52" rx="5" fill="#425960" />
          <rect x="103" y="114" width="73" height="40" rx="2" fill="#c0d0ca" />
          <path d="M140 161v-8m-13 9h27" stroke="#425960" strokeWidth="5" />
          <path d="M287 126v130m-20 0h40" stroke="#586b65" strokeWidth="5" />
          <path d="m268 69-19 58h73l-19-58Z" fill="#ddd0b8" />
          <rect x="118" y="177" width="76" height="51" rx="18" fill="#8c9d8b" />
          <path
            d="M121 235h70m-54-8-5 29m42-29 5 29"
            stroke="#586b65"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M218 151v-34m0 17c-24 0-22-24-22-24 24 0 22 24 22 24Zm1-10c0-25 21-25 21-25s2 24-21 25Z"
            fill="#6e9781"
            stroke="#6e9781"
            strokeWidth="2"
          />
          <path d="m204 142 4 19h21l4-19" fill="#d0b59a" />
        </>
      )}
    </svg>
  );
}
