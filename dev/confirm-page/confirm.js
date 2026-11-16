// Development only: plays the frontend's part for the emailed magic link.
(function () {
  'use strict';

  var EXPIRED_MESSAGE = 'Verification code or token has expired';

  var statusEl = document.getElementById('status');
  var detailsEl = document.getElementById('details');

  function show(status, details) {
    statusEl.textContent = status;
    detailsEl.textContent = details || '';
  }

  var token = new URLSearchParams(location.search).get('token');
  // Drop the token from the address bar and history as soon as it has been read
  history.replaceState(null, '', location.pathname);

  if (!token) {
    show('This link is incomplete.');
    return;
  }

  fetch('/auth/register/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
    cache: 'no-store',
  }).then(
    function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          render(response.status, body);
        });
    },
    function () {
      showUnreachable();
    },
  );

  function render(httpStatus, body) {
    if (httpStatus === 200) {
      show(
        'Your account is active.',
        'Email: ' + body.email + ', status: ' + body.status,
      );
    } else if (httpStatus === 400 && body.message === EXPIRED_MESSAGE) {
      show(
        'This link has expired. Request a new link (resend) and use the newest email.',
      );
    } else if (httpStatus === 400) {
      show('This link is invalid or was already used.');
    } else if (httpStatus === 502 || httpStatus === 504) {
      showUnreachable();
    } else {
      show('Confirmation failed (HTTP ' + httpStatus + ').');
    }
  }

  function showUnreachable() {
    show(
      'The confirmation service could not be reached. Try the link again later.',
    );
  }
})();
