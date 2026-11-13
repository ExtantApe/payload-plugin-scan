'use client'

import { useEffect, useState } from 'react'

/**
 * "Sign in" for a signed-out scan. Its own small script carries the link's fragment (where an activation secret
 * travels) onto the sign-in link's fragment, so it never reaches a server: not in a query, a cookie or storage.
 * Your sign-in page puts `location.hash` back on the return URL when it redirects.
 */
export function ScanSignIn({ signInPath, returnPath, heading = 'Sign in to continue', body = 'Sign in to see what this code is for.' }: { signInPath: string; returnPath: string; heading?: string; body?: string }) {
  const [href, setHref] = useState(`${signInPath}?redirect=${encodeURIComponent(returnPath)}`)
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    // The fragment stays a fragment: on the sign-in page's own URL, never inside the query (which the browser would
    // send to the server). Your sign-in page carries `location.hash` onto the return URL when it sends the person back.
    setHref(`${signInPath}?redirect=${encodeURIComponent(returnPath)}${hash && hash.startsWith('#') ? hash : ''}`)
  }, [signInPath, returnPath])
  return (
    <main aria-labelledby="scan-heading">
      <h1 id="scan-heading">{heading}</h1>
      <p>{body}</p>
      <p>
        <a href={href} style={{ display: 'inline-block', minHeight: 44, padding: '10px 16px' }}>
          Sign in
        </a>
      </p>
    </main>
  )
}

/** The one shared page for a signed-in person when a code isn't theirs, doesn't exist, or isn't a code. */
export function ScanNothingHere({ switchAccountPath, heading = 'Nothing here for this account', body = 'This code isn’t linked to the account you’re signed in with.' }: { switchAccountPath: string; heading?: string; body?: string }) {
  return (
    <main aria-labelledby="scan-heading">
      <h1 id="scan-heading">{heading}</h1>
      <p>{body}</p>
      <p>
        <a href={switchAccountPath} style={{ display: 'inline-block', minHeight: 44, padding: '10px 16px' }}>
          Use another account
        </a>
      </p>
    </main>
  )
}

/** For staff, a code that doesn't exist in their site. */
export function ScanNotFound({ heading = 'Not found', body = 'No record has this code in your site.' }: { heading?: string; body?: string }) {
  return (
    <main aria-labelledby="scan-heading">
      <h1 id="scan-heading">{heading}</h1>
      <p>{body}</p>
    </main>
  )
}
