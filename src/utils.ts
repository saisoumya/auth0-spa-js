import fetch from 'unfetch';

import {
  AuthenticationResult,
  PopupConfigOptions,
  TokenEndpointOptions
} from './global';

import {
  DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS,
  DEFAULT_SILENT_TOKEN_RETRY_COUNT,
  DEFAULT_FETCH_TIMEOUT_MS,
  CLEANUP_IFRAME_TIMEOUT_IN_SECONDS
} from './constants';

const dedupe = arr => arr.filter((x, i) => arr.indexOf(x) === i);

const TIMEOUT_ERROR = { error: 'timeout', error_description: 'Timeout' };

export const createAbortController = () => new AbortController();

export const getUniqueScopes = (...scopes: string[]) => {
  const scopeString = scopes.filter(Boolean).join();
  return dedupe(scopeString.replace(/\s/g, ',').split(',')).join(' ').trim();
};

export const parseQueryResult = (queryString: string) => {
  if (queryString.indexOf('#') > -1) {
    queryString = queryString.substr(0, queryString.indexOf('#'));
  }

  let queryParams = queryString.split('&');

  let parsedQuery: any = {};
  queryParams.forEach(qp => {
    let [key, val] = qp.split('=');
    parsedQuery[key] = decodeURIComponent(val);
  });

  return <AuthenticationResult>{
    ...parsedQuery,
    expires_in: parseInt(parsedQuery.expires_in)
  };
};

export const runIframe = (
  authorizeUrl: string,
  eventOrigin: string,
  timeoutInSeconds: number = DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS
) => {
  return new Promise<AuthenticationResult>((res, rej) => {
    var iframe = window.document.createElement('iframe');
    iframe.setAttribute('width', '0');
    iframe.setAttribute('height', '0');
    iframe.style.display = 'none';

    const removeIframe = () => {
      if (window.document.body.contains(iframe)) {
        window.document.body.removeChild(iframe);
      }
    };

    const timeoutSetTimeoutId = setTimeout(() => {
      rej(TIMEOUT_ERROR);
      removeIframe();
    }, timeoutInSeconds * 1000);

    const iframeEventHandler = function (e: MessageEvent) {
      if (e.origin != eventOrigin) return;
      if (!e.data || e.data.type !== 'authorization_response') return;
      const eventSource = e.source;
      if (eventSource) {
        (<any>eventSource).close();
      }
      e.data.response.error ? rej(e.data.response) : res(e.data.response);
      clearTimeout(timeoutSetTimeoutId);
      window.removeEventListener('message', iframeEventHandler, false);
      // Delay the removal of the iframe to prevent hanging loading status
      // in Chrome: https://github.com/auth0/auth0-spa-js/issues/240
      setTimeout(removeIframe, CLEANUP_IFRAME_TIMEOUT_IN_SECONDS * 1000);
    };
    window.addEventListener('message', iframeEventHandler, false);
    window.document.body.appendChild(iframe);
    iframe.setAttribute('src', authorizeUrl);
  });
};

const openPopup = url => {
  const width = 400;
  const height = 600;
  const left = window.screenX + (window.innerWidth - width) / 2;
  const top = window.screenY + (window.innerHeight - height) / 2;

  return window.open(
    url,
    'auth0:authorize:popup',
    `left=${left},top=${top},width=${width},height=${height},resizable,scrollbars=yes,status=1`
  );
};

export const runPopup = (authorizeUrl: string, config: PopupConfigOptions) => {
  let popup = config.popup;

  if (popup) {
    popup.location.href = authorizeUrl;
  } else {
    popup = openPopup(authorizeUrl);
  }

  if (!popup) {
    throw new Error('Could not open popup');
  }

  return new Promise<AuthenticationResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject({ ...TIMEOUT_ERROR, popup });
    }, (config.timeoutInSeconds || DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS) * 1000);
    window.addEventListener('message', e => {
      if (!e.data || e.data.type !== 'authorization_response') {
        return;
      }
      clearTimeout(timeoutId);
      popup.close();
      if (e.data.response.error) {
        return reject(e.data.response);
      }
      resolve(e.data.response);
    });
  });
};

export const createRandomString = () => {
  const charset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_~.';
  let random = '';
  const randomValues = Array.from(
    getCrypto().getRandomValues(new Uint8Array(43))
  );
  randomValues.forEach(v => (random += charset[v % charset.length]));
  return random;
};

export const encode = (value: string) => btoa(value);
export const decode = (value: string) => atob(value);

export const createQueryParams = (params: any) => {
  return Object.keys(params)
    .filter(k => typeof params[k] !== 'undefined')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
};

export const sha256 = async (s: string) => {
  const digestOp = getCryptoSubtle().digest(
    { name: 'SHA-256' },
    new TextEncoder().encode(s)
  );

  // msCrypto (IE11) uses the old spec, which is not Promise based
  // https://msdn.microsoft.com/en-us/expression/dn904640(v=vs.71)
  // Instead of returning a promise, it returns a CryptoOperation
  // with a result property in it.
  // As a result, the various events need to be handled in the event that we're
  // working in IE11 (hence the msCrypto check). These events just call resolve
  // or reject depending on their intention.
  if ((<any>window).msCrypto) {
    return new Promise((res, rej) => {
      digestOp.oncomplete = e => {
        res(e.target.result);
      };

      digestOp.onerror = (e: ErrorEvent) => {
        rej(e.error);
      };

      digestOp.onabort = () => {
        rej('The digest operation was aborted');
      };
    });
  }

  return await digestOp;
};

const urlEncodeB64 = (input: string) => {
  const b64Chars = { '+': '-', '/': '_', '=': '' };
  return input.replace(/[\+\/=]/g, (m: string) => b64Chars[m]);
};

// https://stackoverflow.com/questions/30106476/
const decodeB64 = input =>
  decodeURIComponent(
    atob(input)
      .split('')
      .map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join('')
  );

export const urlDecodeB64 = (input: string) =>
  decodeB64(input.replace(/_/g, '/').replace(/-/g, '+'));

export const bufferToBase64UrlEncoded = input => {
  const ie11SafeInput = new Uint8Array(input);
  return urlEncodeB64(
    window.btoa(String.fromCharCode(...Array.from(ie11SafeInput)))
  );
};

const sendMessage = (message, to) =>
  new Promise(function (resolve, reject) {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = function (event) {
      // Only for fetch errors, as these get retried
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
    };
    to.postMessage(message, [messageChannel.port2]);
  });

const switchFetch = async (url, opts, timeout, worker) => {
  if (worker) {
    // AbortSignal is not serializable, need to implement in the Web Worker
    delete opts.signal;
    return sendMessage({ url, timeout, ...opts }, worker);
  } else {
    const response = await fetch(url, opts);
    return {
      ok: response.ok,
      json: await response.json()
    };
  }
};

const fetchWithTimeout = (
  url,
  options,
  worker,
  timeout = DEFAULT_FETCH_TIMEOUT_MS
) => {
  const controller = createAbortController();
  const signal = controller.signal;

  const fetchOptions = {
    ...options,
    signal
  };

  // The promise will resolve with one of these two promises (the fetch or the timeout), whichever completes first.
  return Promise.race([
    switchFetch(url, fetchOptions, timeout, worker),
    new Promise((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error("Timeout when executing 'fetch'"));
      }, timeout);
    })
  ]);
};

const getJSON = async (url, timeout, options, worker) => {
  let fetchError, response;

  for (let i = 0; i < DEFAULT_SILENT_TOKEN_RETRY_COUNT; i++) {
    try {
      response = await fetchWithTimeout(url, options, worker, timeout);
      fetchError = null;
      break;
    } catch (e) {
      // Fetch only fails in the case of a network issue, so should be
      // retried here. Failure status (4xx, 5xx, etc) return a resolved Promise
      // with the failure in the body.
      // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
      fetchError = e;
    }
  }

  if (fetchError) {
    throw fetchError;
  }

  const {
    json: { error, error_description, ...success },
    ok
  } = response;

  if (!ok) {
    const errorMessage =
      error_description || `HTTP error. Unable to fetch ${url}`;
    const e = <any>new Error(errorMessage);

    e.error = error || 'request_error';
    e.error_description = errorMessage;

    throw e;
  }

  return success;
};

export const oauthToken = async (
  { baseUrl, timeout, ...options }: TokenEndpointOptions,
  worker
) =>
  await getJSON(
    `${baseUrl}/oauth/token`,
    timeout,
    {
      method: 'POST',
      body: JSON.stringify({
        redirect_uri: window.location.origin,
        ...options
      }),
      headers: {
        'Content-type': 'application/json'
      }
    },
    worker
  );

export const getCrypto = () => {
  //ie 11.x uses msCrypto
  return <Crypto>(window.crypto || (<any>window).msCrypto);
};

export const getCryptoSubtle = () => {
  const crypto = getCrypto();
  //safari 10.x uses webkitSubtle
  return crypto.subtle || (<any>crypto).webkitSubtle;
};

export const validateCrypto = () => {
  if (!getCrypto()) {
    throw new Error(
      'For security reasons, `window.crypto` is required to run `auth0-spa-js`.'
    );
  }
  if (typeof getCryptoSubtle() === 'undefined') {
    throw new Error(`
      auth0-spa-js must run on a secure origin.
      See https://github.com/auth0/auth0-spa-js/blob/master/FAQ.md#why-do-i-get-auth0-spa-js-must-run-on-a-secure-origin 
      for more information.
    `);
  }
};
