import 'package:flutter/material.dart';

import 'qedra_wallet_app.dart';
import 'wallet_scenario_client.dart';

const _vulnerableApi = String.fromEnvironment(
  'QEDRA_VULNERABLE_API',
  defaultValue: 'http://127.0.0.1:3001/',
);
const _fixedApi = String.fromEnvironment(
  'QEDRA_FIXED_API',
  defaultValue: 'http://127.0.0.1:3002/',
);
const _passportUrl = String.fromEnvironment(
  'QEDRA_PASSPORT_URL',
  defaultValue: 'http://127.0.0.1:4173/evidence/passport.html',
);

void main() {
  runApp(
    QedraWalletApp(
      client: HttpWalletScenarioClient(
        vulnerableBaseUri: Uri.parse(_vulnerableApi),
        fixedBaseUri: Uri.parse(_fixedApi),
        passportUri: Uri.parse(_passportUrl),
      ),
    ),
  );
}
