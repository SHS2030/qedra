# QEDRA demo wallet

This minimal Flutter client visualizes the deterministic
`TRANSFER_IDEMPOTENCY` proof against two wallet API targets. It executes the
same six HTTP operations against the deliberately vulnerable target and the
corrected target, then shows:

- initial balances (`A = 10,000`, `B = 5,000` FCFA);
- the duplicate debit before repair (`A = 8,000`, `B = 7,000`, two pairs);
- the exact replay after repair (`A = 9,000`, `B = 6,000`, one pair);
- evidence-passport availability and the mandatory human-approval state.

The production transport uses only `dart:io`. The `WalletScenarioClient`
interface is injected, so widget tests never depend on a live service.

## Validate

```powershell
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze --no-pub
flutter test --no-pub
```

## Endpoint configuration

The defaults expect vulnerable and corrected wallet APIs on ports 3001 and
3002, and a served standalone passport on port 4173. This repository does not
include generated platform runners or a command that starts those three local
services, so `flutter run` is not part of the verified Genesis demo. After a
distributor adds a platform runner and supplies the services, endpoints can be
overridden with compile-time definitions such as:

```powershell
flutter run -d windows `
  --dart-define=QEDRA_VULNERABLE_API=http://127.0.0.1:3001/ `
  --dart-define=QEDRA_FIXED_API=http://127.0.0.1:3002/ `
  --dart-define=QEDRA_PASSPORT_URL=http://127.0.0.1:4173/evidence/passport.html
```

This vertical slice commits the portable Dart application, transport, and
tests, but not generated operating-system runner boilerplate. Add the desired
Flutter platform runner at distribution time; the validated source remains
platform-neutral except for its `dart:io` HTTP transport.

The client reports a passport as `AVAILABLE` only when its URL returns HTTP 200. Cryptographic passport verification remains the responsibility of QEDRA's
evidence verifier; the UI does not claim that network availability proves
integrity.
