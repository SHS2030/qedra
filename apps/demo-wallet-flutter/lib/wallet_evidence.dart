enum PassportAvailability { available, unavailable }

final class WalletBalances {
  const WalletBalances({required this.source, required this.destination});

  final int source;
  final int destination;
}

final class WalletObservation {
  const WalletObservation({
    required this.balances,
    required this.debitCount,
    required this.creditCount,
  });

  final WalletBalances balances;
  final int debitCount;
  final int creditCount;

  bool get invariantPassed =>
      balances.source == 9000 &&
      balances.destination == 6000 &&
      debitCount == 1 &&
      creditCount == 1;
}

final class WalletComparison {
  const WalletComparison({
    required this.initialBalances,
    required this.beforeRepair,
    required this.afterRepair,
    required this.passportUri,
    required this.passportAvailability,
    required this.humanApprovalRequired,
  });

  final WalletBalances initialBalances;
  final WalletObservation beforeRepair;
  final WalletObservation afterRepair;
  final Uri passportUri;
  final PassportAvailability passportAvailability;
  final bool humanApprovalRequired;

  bool get proofSatisfied =>
      !beforeRepair.invariantPassed && afterRepair.invariantPassed;
}
