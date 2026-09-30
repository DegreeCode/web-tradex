import Link from "next/link";

import { SiteDisclaimer } from "@/components/site-disclaimer";

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

export function LegalDocument({
  title,
  effectiveDate,
  intro,
  sections,
  closing,
}: {
  title: string;
  effectiveDate: string;
  intro: React.ReactNode;
  sections: LegalSection[];
  closing?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh px-4 py-10 sm:px-5">
      <div className="mx-auto w-full max-w-[720px]">
        <Link
          href="/"
          prefetch={false}
          className="text-[20px] font-extrabold tracking-[-0.04em] text-app-gray-900"
        >
          Trade<span className="text-app-blue">X</span>
        </Link>
        <h1 className="mt-6 text-[26px] font-bold tracking-[-0.02em] text-app-gray-900">
          {title}
        </h1>
        <p className="mt-1.5 text-[13px] text-app-gray-500">시행일 {effectiveDate}</p>
        <div className="mt-4 text-[15px] leading-7 text-app-gray-700">{intro}</div>

        <nav
          aria-label="목차"
          className="mt-6 rounded-2xl bg-card p-5 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]"
        >
          <p className="text-[13px] font-semibold text-app-gray-900">목차</p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-app-gray-600 hover:text-app-blue"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-3 space-y-3">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="scroll-mt-6 rounded-2xl bg-card p-5 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)] sm:p-6"
            >
              <h2
                id={`${section.id}-title`}
                className="text-[17px] font-bold tracking-[-0.01em] text-app-gray-900"
              >
                {section.title}
              </h2>
              <div className="mt-3 space-y-3 text-[14px] leading-7 break-keep text-app-gray-700 [&_a]:font-semibold [&_a]:text-app-blue [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-app-gray-900 [&_ul]:list-disc [&_ul]:pl-5">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        {closing && (
          <div className="mt-6 px-1 text-[13px] leading-6 text-app-gray-500">{closing}</div>
        )}

        <SiteDisclaimer stacked className="mt-10" />
      </div>
    </div>
  );
}

export function LegalTable({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-app-gray-200">
      <table className="w-full min-w-[520px] text-left text-[13px] leading-6">
        <thead className="bg-app-gray-50 text-app-gray-600">
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-app-gray-200 align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
