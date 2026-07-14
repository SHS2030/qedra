import 'dart:convert';
import 'dart:io';

import 'wallet_evidence.dart';

abstract interface class WalletScenarioClient {
  Future<WalletComparison> runDeterministicComparison();
}

typedef HttpClientFactory = HttpClient Function();

final class HttpWalletScenarioClient implements WalletScenarioClient {
  HttpWalletScenarioClient({
    required this.vulnerableBaseUri,
    required this.fixedBaseUri,
    required this.passportUri,
    HttpClientFactory? httpClientFactory,
  }) : _httpClientFactory = httpClientFactory ?? HttpClient.new;

  final Uri vulnerableBaseUri;
  final Uri fixedBaseUri;
  final Uri passportUri;
  final HttpClientFactory _httpClientFactory;

  static const WalletBalances _initialBalances = WalletBalances(
    source: 10000,
    destination: 5000,
  );

  @override
  Future<WalletComparison> runDeterministicComparison() async {
    final beforeRepair = await _runTarget(vulnerableBaseUri);
    final afterRepair = await _runTarget(fixedBaseUri);
    final passportAvailability = await _readPassportAvailability();

    return WalletComparison(
      initialBalances: _initialBalances,
      beforeRepair: beforeRepair,
      afterRepair: afterRepair,
      passportUri: passportUri,
      passportAvailability: passportAvailability,
      humanApprovalRequired: true,
    );
  }

  Future<WalletObservation> _runTarget(Uri baseUri) async {
    final client = _httpClientFactory();
    try {
      await _jsonRequest(
        client,
        baseUri.resolve('reset'),
        method: 'POST',
        body: const <String, Object?>{},
        expectedStatusCode: HttpStatus.ok,
      );
      await _jsonRequest(
        client,
        baseUri.resolve('seed'),
        method: 'POST',
        body: const <String, Object?>{
          'wallets': <String, int>{'A': 10000, 'B': 5000},
        },
        expectedStatusCode: HttpStatus.ok,
      );
      await _jsonRequest(
        client,
        baseUri.resolve('transfer'),
        method: 'POST',
        body: const <String, Object?>{
          'requestId': 'TX-001',
          'sourceWalletId': 'A',
          'destinationWalletId': 'B',
          'amount': 1000,
          'failureMode': 'timeout-after-commit',
        },
        expectedStatusCode: HttpStatus.gatewayTimeout,
      );
      await _jsonRequest(
        client,
        baseUri.resolve('transfer'),
        method: 'POST',
        body: const <String, Object?>{
          'requestId': 'TX-001',
          'sourceWalletId': 'A',
          'destinationWalletId': 'B',
          'amount': 1000,
        },
        expectedStatusCode: HttpStatus.ok,
      );
      final balancesResponse = await _jsonRequest(
        client,
        baseUri.resolve('balances'),
        method: 'GET',
        expectedStatusCode: HttpStatus.ok,
      );
      final ledgerResponse = await _jsonRequest(
        client,
        baseUri.resolve('ledger?requestId=TX-001'),
        method: 'GET',
        expectedStatusCode: HttpStatus.ok,
      );

      final balances = _objectField(balancesResponse, 'balances');
      final entries = _listField(ledgerResponse, 'entries');
      var debitCount = 0;
      var creditCount = 0;
      for (final entryValue in entries) {
        if (entryValue is! Map<String, Object?>) {
          throw const FormatException('A ledger entry is not a JSON object.');
        }
        if (entryValue['requestId'] != 'TX-001') {
          continue;
        }
        if (entryValue['walletId'] == 'A' &&
            entryValue['direction'] == 'DEBIT') {
          debitCount += 1;
        }
        if (entryValue['walletId'] == 'B' &&
            entryValue['direction'] == 'CREDIT') {
          creditCount += 1;
        }
      }

      return WalletObservation(
        balances: WalletBalances(
          source: _integerField(balances, 'A'),
          destination: _integerField(balances, 'B'),
        ),
        debitCount: debitCount,
        creditCount: creditCount,
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<PassportAvailability> _readPassportAvailability() async {
    final client = _httpClientFactory();
    try {
      final request = await client.getUrl(passportUri);
      final response = await request.close();
      await response.drain<void>();
      return response.statusCode == HttpStatus.ok
          ? PassportAvailability.available
          : PassportAvailability.unavailable;
    } on Object {
      return PassportAvailability.unavailable;
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, Object?>> _jsonRequest(
    HttpClient client,
    Uri uri, {
    required String method,
    required int expectedStatusCode,
    Map<String, Object?>? body,
  }) async {
    final request = await client.openUrl(method, uri);
    request.headers.set(HttpHeaders.acceptHeader, ContentType.json.mimeType);
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close();
    final responseText = await utf8.decoder.bind(response).join();
    if (response.statusCode != expectedStatusCode) {
      throw HttpException(
        '$method ${uri.path} returned HTTP ${response.statusCode}; '
        'expected $expectedStatusCode.',
        uri: uri,
      );
    }
    if (responseText.isEmpty) {
      return <String, Object?>{};
    }
    final decoded = jsonDecode(responseText);
    if (decoded is! Map<String, Object?>) {
      throw FormatException(
        '$method ${uri.path} did not return a JSON object.',
      );
    }
    return decoded;
  }

  static Map<String, Object?> _objectField(
    Map<String, Object?> value,
    String field,
  ) {
    final candidate = value[field];
    if (candidate is! Map<String, Object?>) {
      throw FormatException('$field is not a JSON object.');
    }
    return candidate;
  }

  static List<Object?> _listField(Map<String, Object?> value, String field) {
    final candidate = value[field];
    if (candidate is! List<Object?>) {
      throw FormatException('$field is not a JSON array.');
    }
    return candidate;
  }

  static int _integerField(Map<String, Object?> value, String field) {
    final candidate = value[field];
    if (candidate is! int) {
      throw FormatException('$field is not an integer.');
    }
    return candidate;
  }
}
