import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:qedra_demo_wallet/wallet_evidence.dart';
import 'package:qedra_demo_wallet/wallet_scenario_client.dart';

void main() {
  test(
    'executes the exact timeout and retry sequence against both targets',
    () async {
      final vulnerable = await _ScenarioServer.start(
        balances: const <String, int>{'A': 8000, 'B': 7000},
        duplicateCount: 2,
      );
      final fixed = await _ScenarioServer.start(
        balances: const <String, int>{'A': 9000, 'B': 6000},
        duplicateCount: 1,
        servePassport: true,
      );
      addTearDown(() async {
        await vulnerable.close();
        await fixed.close();
      });

      final client = HttpWalletScenarioClient(
        vulnerableBaseUri: vulnerable.baseUri,
        fixedBaseUri: fixed.baseUri,
        passportUri: fixed.baseUri.resolve('passport.html'),
      );

      final comparison = await client.runDeterministicComparison();

      expect(comparison.initialBalances.source, 10000);
      expect(comparison.beforeRepair.balances.source, 8000);
      expect(comparison.beforeRepair.debitCount, 2);
      expect(comparison.afterRepair.balances.source, 9000);
      expect(comparison.afterRepair.debitCount, 1);
      expect(comparison.proofSatisfied, isTrue);
      expect(comparison.passportAvailability, PassportAvailability.available);
      expect(comparison.humanApprovalRequired, isTrue);
      expect(vulnerable.requests, _expectedScenarioRequests);
      expect(fixed.requests, <String>[
        ..._expectedScenarioRequests,
        'GET /passport.html',
      ]);
    },
  );

  test(
    'reports an unavailable passport without hiding proof results',
    () async {
      final vulnerable = await _ScenarioServer.start(
        balances: const <String, int>{'A': 8000, 'B': 7000},
        duplicateCount: 2,
      );
      final fixed = await _ScenarioServer.start(
        balances: const <String, int>{'A': 9000, 'B': 6000},
        duplicateCount: 1,
      );
      addTearDown(() async {
        await vulnerable.close();
        await fixed.close();
      });

      final client = HttpWalletScenarioClient(
        vulnerableBaseUri: vulnerable.baseUri,
        fixedBaseUri: fixed.baseUri,
        passportUri: fixed.baseUri.resolve('missing-passport.html'),
      );

      final comparison = await client.runDeterministicComparison();

      expect(comparison.proofSatisfied, isTrue);
      expect(comparison.passportAvailability, PassportAvailability.unavailable);
    },
  );
}

const _expectedScenarioRequests = <String>[
  'POST /reset',
  'POST /seed',
  'POST /transfer',
  'POST /transfer',
  'GET /balances',
  'GET /ledger?requestId=TX-001',
];

final class _ScenarioServer {
  _ScenarioServer._(this._server, this._subscription);

  final HttpServer _server;
  final StreamSubscription<HttpRequest> _subscription;
  final List<String> requests = <String>[];

  Uri get baseUri => Uri.parse('http://127.0.0.1:${_server.port}/');

  static Future<_ScenarioServer> start({
    required Map<String, int> balances,
    required int duplicateCount,
    bool servePassport = false,
  }) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    late final _ScenarioServer fixture;
    var transferCount = 0;
    final subscription = server.listen((HttpRequest request) async {
      final path = request.uri.hasQuery
          ? '${request.uri.path}?${request.uri.query}'
          : request.uri.path;
      fixture.requests.add('${request.method} $path');
      await utf8.decoder.bind(request).join();

      if (request.uri.path == '/passport.html' && servePassport) {
        request.response
          ..statusCode = HttpStatus.ok
          ..headers.contentType = ContentType.html
          ..write('<!doctype html><title>QEDRA passport</title>');
        await request.response.close();
        return;
      }
      if (request.uri.path == '/reset' || request.uri.path == '/seed') {
        await _sendJson(request.response, HttpStatus.ok, <String, Object?>{
          'status': 'ok',
        });
        return;
      }
      if (request.uri.path == '/transfer') {
        transferCount += 1;
        await _sendJson(
          request.response,
          transferCount == 1 ? HttpStatus.gatewayTimeout : HttpStatus.ok,
          transferCount == 1
              ? <String, Object?>{
                  'error': 'TIMEOUT_AFTER_COMMIT',
                  'requestId': 'TX-001',
                }
              : <String, Object?>{'status': 'completed', 'requestId': 'TX-001'},
        );
        return;
      }
      if (request.uri.path == '/balances') {
        await _sendJson(request.response, HttpStatus.ok, <String, Object?>{
          'balances': balances,
        });
        return;
      }
      if (request.uri.path == '/ledger') {
        final entries = <Map<String, Object?>>[];
        for (var index = 0; index < duplicateCount; index += 1) {
          entries
            ..add(<String, Object?>{
              'id': index * 2 + 1,
              'requestId': 'TX-001',
              'walletId': 'A',
              'direction': 'DEBIT',
              'amount': 1000,
              'balanceAfter': balances['A'],
            })
            ..add(<String, Object?>{
              'id': index * 2 + 2,
              'requestId': 'TX-001',
              'walletId': 'B',
              'direction': 'CREDIT',
              'amount': 1000,
              'balanceAfter': balances['B'],
            });
        }
        await _sendJson(request.response, HttpStatus.ok, <String, Object?>{
          'entries': entries,
        });
        return;
      }
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
    });
    fixture = _ScenarioServer._(server, subscription);
    return fixture;
  }

  static Future<void> _sendJson(
    HttpResponse response,
    int statusCode,
    Map<String, Object?> body,
  ) async {
    response
      ..statusCode = statusCode
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(body));
    await response.close();
  }

  Future<void> close() async {
    await _subscription.cancel();
    await _server.close(force: true);
  }
}
