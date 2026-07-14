import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qedra_demo_wallet/qedra_wallet_app.dart';
import 'package:qedra_demo_wallet/wallet_evidence.dart';
import 'package:qedra_demo_wallet/wallet_scenario_client.dart';

void main() {
  testWidgets('shows deterministic balances before and after repair', (
    WidgetTester tester,
  ) async {
    final client = _FakeWalletScenarioClient(_comparison);
    await tester.pumpWidget(QedraWalletApp(client: client));

    expect(find.text('10,000 FCFA'), findsOneWidget);
    expect(find.text('5,000 FCFA'), findsOneWidget);
    expect(find.text('READY'), findsOneWidget);

    await tester.tap(find.byKey(const Key('run-proof')));
    await tester.pumpAndSettle();

    expect(client.calls, 1);
    expect(find.text('8,000 FCFA'), findsOneWidget);
    expect(find.text('7,000 FCFA'), findsOneWidget);
    expect(find.text('9,000 FCFA'), findsOneWidget);
    expect(find.text('6,000 FCFA'), findsOneWidget);
    expect(find.text('2 debit entries · 2 credit entries'), findsOneWidget);
    expect(find.text('1 debit entry · 1 credit entry'), findsOneWidget);
    expect(find.text('INVARIANT FAILED'), findsOneWidget);
    expect(find.text('INVARIANT PASSED'), findsOneWidget);
    expect(find.text('REPLAY PASSED'), findsOneWidget);
    expect(find.text('AVAILABLE'), findsOneWidget);
    expect(find.byKey(const Key('passport-link')), findsOneWidget);
    expect(find.text('Human approval required before merge'), findsOneWidget);
  });

  testWidgets('renders a useful error without inventing proof results', (
    WidgetTester tester,
  ) async {
    final client = _FailingWalletScenarioClient();
    await tester.pumpWidget(QedraWalletApp(client: client));

    await tester.tap(find.byKey(const Key('run-proof')));
    await tester.pumpAndSettle();

    expect(find.text('Proof run failed'), findsOneWidget);
    expect(find.textContaining('target unavailable'), findsOneWidget);
    expect(find.byKey(const Key('before-repair')), findsNothing);
    expect(find.byKey(const Key('after-repair')), findsNothing);
  });
}

final _comparison = WalletComparison(
  initialBalances: const WalletBalances(source: 10000, destination: 5000),
  beforeRepair: const WalletObservation(
    balances: WalletBalances(source: 8000, destination: 7000),
    debitCount: 2,
    creditCount: 2,
  ),
  afterRepair: const WalletObservation(
    balances: WalletBalances(source: 9000, destination: 6000),
    debitCount: 1,
    creditCount: 1,
  ),
  passportUri: Uri.parse('http://127.0.0.1:4173/evidence/passport.html'),
  passportAvailability: PassportAvailability.available,
  humanApprovalRequired: true,
);

final class _FakeWalletScenarioClient implements WalletScenarioClient {
  _FakeWalletScenarioClient(this.result);

  final WalletComparison result;
  int calls = 0;

  @override
  Future<WalletComparison> runDeterministicComparison() async {
    calls += 1;
    return result;
  }
}

final class _FailingWalletScenarioClient implements WalletScenarioClient {
  @override
  Future<WalletComparison> runDeterministicComparison() async {
    throw StateError('target unavailable');
  }
}
