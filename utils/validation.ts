const MULTI_PART_TLDS: Record<string, true> = {
  "co.uk": true,
  "ac.uk": true,
  "gov.uk": true,
  "org.uk": true,
  "nhs.uk": true,
  "police.uk": true,
  "sch.uk": true,
  "com.au": true,
  "net.au": true,
  "org.au": true,
  "edu.au": true,
  "gov.au": true,
  "co.nz": true,
  "net.nz": true,
  "org.nz": true,
  "govt.nz": true,
  "ac.nz": true,
  "co.za": true,
  "co.jp": true,
  "co.kr": true,
  "co.in": true,
  "com.br": true,
  "com.cn": true,
  "com.mx": true,
  "com.sg": true,
};

function isIpAddress(value: string): boolean {
  const ipv4 =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6 = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
  return (
    ipv4.test(value) ||
    ipv6.test(value) ||
    (value.includes("::") && value.split("::").length === 2)
  );
}

function getRegistrableDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  const possibleTld = parts.slice(-2).join(".");
  return parts.length >= 3 && MULTI_PART_TLDS[possibleTld] === true
    ? parts.slice(-3).join(".")
    : parts.slice(-2).join(".");
}

/**
 * Determines whether two hostnames have the same site identity.
 *
 * Exact equality is required for IP addresses and localhost; DNS hostnames
 * compare their registrable domains, including known multi-part public suffixes.
 */
export function isSameSite(domain1: string, domain2: string): boolean {
  if (isIpAddress(domain1) && isIpAddress(domain2)) {
    return domain1 === domain2;
  }

  if (domain1 === "localhost" || domain2 === "localhost") {
    return domain1 === domain2;
  }

  return getRegistrableDomain(domain1) === getRegistrableDomain(domain2);
}
