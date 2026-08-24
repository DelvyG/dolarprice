-- Esquema de DolarPrice. Dos tablas: el estado actual (lecturas rapidas) y el
-- historico, en el que solo se inserta cuando el valor realmente cambia.

CREATE TABLE IF NOT EXISTS `rates_current` (
  `code`        VARCHAR(10)  NOT NULL,          -- USD, EUR, CNY, TRY, RUB, USDT
  `source`      VARCHAR(20)  NOT NULL,          -- BCV | BINANCE
  `rate`        DECIMAL(20,8) NOT NULL,
  `buy`         DECIMAL(20,8) NULL,             -- solo Binance
  `sell`        DECIMAL(20,8) NULL,             -- solo Binance
  `value_date`  DATE         NULL,              -- "fecha valor" publicada por el BCV
  `meta`        TEXT         NULL,              -- JSON con el detalle del calculo
  `changed_at`  DATETIME     NOT NULL,          -- ultima vez que el valor cambio
  `checked_at`  DATETIME     NOT NULL,          -- ultima vez que se consulto la fuente
  PRIMARY KEY (`code`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `rates_history` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(10)  NOT NULL,
  `source`      VARCHAR(20)  NOT NULL,
  `rate`        DECIMAL(20,8) NOT NULL,
  `buy`         DECIMAL(20,8) NULL,
  `sell`        DECIMAL(20,8) NULL,
  `value_date`  DATE         NULL,
  `fetched_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_code_source_fetched` (`code`, `source`, `fetched_at`),
  KEY `idx_fetched` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registro de cada corrida del capturador, para poder ver desde el panel
-- si una fuente lleva rato fallando.
CREATE TABLE IF NOT EXISTS `ingest_runs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source`      VARCHAR(20)  NOT NULL,
  `ok`          TINYINT(1)   NOT NULL,
  `message`     VARCHAR(500) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `ran_at`      DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_source_ran` (`source`, `ran_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
