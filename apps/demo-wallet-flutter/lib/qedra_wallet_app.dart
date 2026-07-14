import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'wallet_evidence.dart';
import 'wallet_scenario_client.dart';

class QedraWalletApp extends StatelessWidget {
  const QedraWalletApp({required this.client, super.key});

  final WalletScenarioClient client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'QEDRA Wallet Proof',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff41d9a2),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xff09110f),
        cardTheme: const CardThemeData(
          color: Color(0xff111d19),
          margin: EdgeInsets.zero,
        ),
        useMaterial3: true,
      ),
      home: WalletEvidenceScreen(client: client),
    );
  }
}

class WalletEvidenceScreen extends StatefulWidget {
  const WalletEvidenceScreen({required this.client, super.key});

  final WalletScenarioClient client;

  @override
  State<WalletEvidenceScreen> createState() => _WalletEvidenceScreenState();
}

class _WalletEvidenceScreenState extends State<WalletEvidenceScreen> {
  WalletComparison? _comparison;
  Object? _error;
  bool _running = false;

  Future<void> _runProof() async {
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      final comparison = await widget.client.runDeterministicComparison();
      if (mounted) {
        setState(() => _comparison = comparison);
      }
    } on Object catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted) {
        setState(() => _running = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final comparison = _comparison;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1080),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _Header(proofSatisfied: comparison?.proofSatisfied),
                  const SizedBox(height: 24),
                  const _LawCard(),
                  const SizedBox(height: 16),
                  _InitialState(
                    balances:
                        comparison?.initialBalances ??
                        const WalletBalances(source: 10000, destination: 5000),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    key: const Key('run-proof'),
                    onPressed: _running ? null : _runProof,
                    icon: _running
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.play_arrow_rounded),
                    label: Text(
                      _running
                          ? 'Running exact HTTP replay…'
                          : 'Run timeout/retry proof',
                    ),
                  ),
                  if (_error != null) ...<Widget>[
                    const SizedBox(height: 12),
                    _ErrorPanel(error: _error!),
                  ],
                  if (comparison != null) ...<Widget>[
                    const SizedBox(height: 24),
                    _ComparisonGrid(comparison: comparison),
                    const SizedBox(height: 16),
                    _PassportPanel(comparison: comparison),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.proofSatisfied});

  final bool? proofSatisfied;

  @override
  Widget build(BuildContext context) {
    final status = switch (proofSatisfied) {
      true => 'REPLAY PASSED',
      false => 'CHECK FAILED',
      null => 'READY',
    };
    final color = switch (proofSatisfied) {
      true => const Color(0xff41d9a2),
      false => const Color(0xffff7474),
      null => const Color(0xffa8b7b1),
    };
    return Row(
      children: <Widget>[
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'QEDRA',
                style: TextStyle(
                  color: Color(0xff41d9a2),
                  fontWeight: FontWeight.w800,
                  letterSpacing: 3,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Wallet evidence console',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
        _StatusBadge(label: status, color: color),
      ],
    );
  }
}

class _LawCard extends StatelessWidget {
  const _LawCard();

  @override
  Widget build(BuildContext context) {
    return const _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'PROTECTED LAW · TRANSFER_IDEMPOTENCY',
            style: TextStyle(
              color: Color(0xff41d9a2),
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
            ),
          ),
          SizedBox(height: 10),
          Text(
            'The same transfer request must never debit a wallet more than once, including after a network timeout and client retry.',
            style: TextStyle(fontSize: 17, height: 1.45),
          ),
          SizedBox(height: 10),
          Text(
            'Deterministic seed · TX-001 · 1,000 FCFA · timeout after commit',
            style: TextStyle(color: Color(0xffa8b7b1)),
          ),
        ],
      ),
    );
  }
}

class _InitialState extends StatelessWidget {
  const _InitialState({required this.balances});

  final WalletBalances balances;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'Initial deterministic state',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 24,
            runSpacing: 12,
            children: <Widget>[
              _Balance(label: 'Wallet A', amount: balances.source),
              _Balance(label: 'Wallet B', amount: balances.destination),
            ],
          ),
        ],
      ),
    );
  }
}

class _ComparisonGrid extends StatelessWidget {
  const _ComparisonGrid({required this.comparison});

  final WalletComparison comparison;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final cardWidth = constraints.maxWidth >= 760
            ? (constraints.maxWidth - 16) / 2
            : constraints.maxWidth;
        return Wrap(
          spacing: 16,
          runSpacing: 16,
          children: <Widget>[
            SizedBox(
              width: cardWidth,
              child: _ResultCard(
                key: const Key('before-repair'),
                eyebrow: 'BEFORE REPAIR · VULNERABLE FIXTURE',
                status: 'INVARIANT FAILED',
                color: const Color(0xffff7474),
                observation: comparison.beforeRepair,
                explanation: 'The retry created a second debit and credit.',
              ),
            ),
            SizedBox(
              width: cardWidth,
              child: _ResultCard(
                key: const Key('after-repair'),
                eyebrow: 'AFTER REPAIR · EXACT REPLAY',
                status: 'INVARIANT PASSED',
                color: const Color(0xff41d9a2),
                observation: comparison.afterRepair,
                explanation:
                    'The stored first result was returned for the retry.',
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({
    required this.eyebrow,
    required this.status,
    required this.color,
    required this.observation,
    required this.explanation,
    super.key,
  });

  final String eyebrow;
  final String status;
  final Color color;
  final WalletObservation observation;
  final String explanation;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      borderColor: color.withValues(alpha: 0.35),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            eyebrow,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 8),
          _StatusBadge(label: status, color: color),
          const SizedBox(height: 18),
          Wrap(
            spacing: 24,
            runSpacing: 12,
            children: <Widget>[
              _Balance(label: 'Wallet A', amount: observation.balances.source),
              _Balance(
                label: 'Wallet B',
                amount: observation.balances.destination,
              ),
            ],
          ),
          const Divider(height: 28),
          Text(
            '${observation.debitCount} debit ${observation.debitCount == 1 ? 'entry' : 'entries'} · '
            '${observation.creditCount} credit ${observation.creditCount == 1 ? 'entry' : 'entries'}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            explanation,
            style: const TextStyle(color: Color(0xffa8b7b1), height: 1.4),
          ),
        ],
      ),
    );
  }
}

class _PassportPanel extends StatelessWidget {
  const _PassportPanel({required this.comparison});

  final WalletComparison comparison;

  Future<void> _copyLink(BuildContext context) async {
    await Clipboard.setData(
      ClipboardData(text: comparison.passportUri.toString()),
    );
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Passport link copied.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final available =
        comparison.passportAvailability == PassportAvailability.available;
    return _Panel(
      borderColor: const Color(0xff315e50),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Text(
                  'Evidence passport',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ),
              _StatusBadge(
                label: available ? 'AVAILABLE' : 'NOT SERVED',
                color: available
                    ? const Color(0xff41d9a2)
                    : const Color(0xffffc766),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SelectableText(
            comparison.passportUri.toString(),
            key: const Key('passport-link'),
            style: const TextStyle(color: Color(0xff72d8ff)),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              OutlinedButton.icon(
                onPressed: () => _copyLink(context),
                icon: const Icon(Icons.copy_rounded),
                label: const Text('Copy passport link'),
              ),
              Text(
                comparison.humanApprovalRequired
                    ? 'Human approval required before merge'
                    : 'Human approval metadata missing',
                style: const TextStyle(color: Color(0xffffc766)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Balance extends StatelessWidget {
  const _Balance({required this.label, required this.amount});

  final String label;
  final int amount;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label, $amount FCFA',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: const TextStyle(color: Color(0xffa8b7b1))),
          const SizedBox(height: 2),
          Text(
            '${_formatAmount(amount)} FCFA',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.55)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
          ),
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child, this.borderColor});

  final Widget child;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(
        side: BorderSide(color: borderColor ?? const Color(0xff263a33)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(padding: const EdgeInsets.all(20), child: child),
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      borderColor: const Color(0xffff7474),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'Proof run failed',
            style: TextStyle(
              color: Color(0xffff7474),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(error.toString(), key: const Key('proof-error')),
        ],
      ),
    );
  }
}

String _formatAmount(int amount) {
  final digits = amount.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 == 0) {
      buffer.write(',');
    }
    buffer.write(digits[index]);
  }
  return buffer.toString();
}
