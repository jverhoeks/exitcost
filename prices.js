// All prices used by ExitCost. Edit here, not in app.js.
// A price is either a number (verified on the official source) or { v, unverified: true, note }.
// Monthly = hourly x 730. EU providers in EUR ex VAT, hyperscalers in USD.
window.PRICES = {
    lastVerified: '2026-10-25',
    fxEurUsd: 1.1193, // ECB reference rate 2026-10-23

    // ---------- 01 Exit: internet egress, USD per GB ----------
    // Tier breakpoints in GB as published by each provider. GCP publishes GiB; we treat GiB ~ GB.
    egress: {
        aws: {
            label: 'AWS', currency: 'USD',
            // Price List API AWSDataTransfer, pub 2026-09-16. 100 GB/month free, aggregated across regions.
            regions: {
                'eu-west': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10240, perGB: 0.09 }, { upToGB: 51200, perGB: 0.085 }, { upToGB: 153600, perGB: 0.07 }, { upToGB: Infinity, perGB: 0.05 }] },
                'us-east': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10240, perGB: 0.09 }, { upToGB: 51200, perGB: 0.085 }, { upToGB: 153600, perGB: 0.07 }, { upToGB: Infinity, perGB: 0.05 }] },
                'asia-pacific': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10240, perGB: 0.12 }, { upToGB: 51200, perGB: 0.085 }, { upToGB: 153600, perGB: 0.082 }, { upToGB: Infinity, perGB: 0.08 }] },
            },
            requestPrice: 0.0004 / 1000, // S3 GET, $0.0004 per 1,000
            waiver: {
                text: 'AWS waives data transfer out for customers moving all data off AWS: contact AWS Support first; the payer account must move everything out, within 180 days. CloudFront, Direct Connect and Snow are excluded. EU customers are pointed to a separate EU Data Act addendum.',
                url: 'https://aws.amazon.com/blogs/aws/free-data-transfer-out-to-internet-when-moving-out-of-aws/',
            },
        },
        azure: {
            label: 'Azure', currency: 'USD',
            // Microsoft Premium Global Network routing. https://azure.microsoft.com/en-us/pricing/details/bandwidth/
            regions: {
                'eu-west': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10100, perGB: 0.087 }, { upToGB: 50100, perGB: 0.083 }, { upToGB: 150100, perGB: 0.07 }, { upToGB: Infinity, perGB: 0.05 }] },
                'us-east': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10100, perGB: 0.087 }, { upToGB: 50100, perGB: 0.083 }, { upToGB: 150100, perGB: 0.07 }, { upToGB: Infinity, perGB: 0.05 }] },
                'asia-pacific': { tiers: [{ upToGB: 100, perGB: 0 }, { upToGB: 10100, perGB: 0.12 }, { upToGB: 50100, perGB: 0.085 }, { upToGB: 150100, perGB: 0.082 }, { upToGB: Infinity, perGB: 0.08 }] },
            },
            requestPrice: 0.0043 / 10000, // Blob Hot LRS read ops, West Europe
            waiver: {
                text: 'Azure credits egress when you move all data off Azure: open a support request first (subscription ID, start date, volume), move within 60 days, cancel all subscriptions, then claim the credit. ExpressRoute, VPN, Front Door and CDN are excluded.',
                url: 'https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/cancel-azure-subscription#what-data-transfer-fees-are-applied-when-moving-all-data-off-azure',
            },
        },
        gcp: {
            label: 'Google Cloud', currency: 'USD',
            // Premium Tier. https://cloud.google.com/vpc/network-pricing. No free band outside us-central1.
            regions: {
                'eu-west': { tiers: [{ upToGB: 1024, perGB: 0.12 }, { upToGB: 10240, perGB: 0.11 }, { upToGB: Infinity, perGB: 0.08 }] },
                'us-east': { tiers: [{ upToGB: 1024, perGB: 0.12 }, { upToGB: 10240, perGB: 0.11 }, { upToGB: Infinity, perGB: 0.08 }] },
                'asia-pacific': { tiers: [{ upToGB: 1024, perGB: 0.12 }, { upToGB: 10240, perGB: 0.11 }, { upToGB: Infinity, perGB: 0.085 }] },
            },
            requestPrice: 0.0004 / 1000, // GCS Class B, Standard regional
            waiver: {
                text: 'Google Cloud waives internet egress for customers leaving: submit an Exit Notice, start within 30 days, migrate all workloads off the service, then file a Completion Notice. The credit lands on the final invoice.',
                url: 'https://cloud.google.com/exit-cloud',
            },
        },
    },

    // ---------- 02 Run: current cloud ----------
    // Sizes: S = 2 vCPU/8 GB, M = 4/16, L = 8/32, XL = 16/64. Prices per month.
    source: {
        aws: {
            label: 'AWS', regionLabel: 'eu-west-1 Ireland', currency: 'USD', egressRegion: 'eu-west',
            // Price List API, pub 2026-09-11 to 2026-10-23
            compute: {
                S: { sku: 'm7i.large', month: 82.02 },
                M: { sku: 'm7i.xlarge', month: 164.03 },
                L: { sku: 'm7i.2xlarge', month: 328.06 },
                XL: { sku: 'm7i.4xlarge', month: 656.12 },
            },
            db: { // RDS PostgreSQL
                S: { sku: 'db.m7g.large', single: 135.78, ha: 271.56 },
                M: { sku: 'db.m7g.xlarge', single: 271.56, ha: 543.85 },
            },
            dbStorageGB: 0.127, // gp3; doubled for Multi-AZ
            objectGB: 0.023, // S3 Standard, first 50 TB
            blockGB: 0.088, // EBS gp3
            natHour: 0.048, natGB: 0.048,
            lbMonth: (0.0252 + 0.008) * 730, // ALB hour + 1 LCU-hour
            lbNote: 'Application Load Balancer with 1 LCU on average.',
            interRegionGB: 0.02, // EU <-> EU
        },
        azure: {
            label: 'Azure', regionLabel: 'West Europe', currency: 'USD', egressRegion: 'eu-west',
            // Retail Prices API, westeurope, pay-as-you-go Linux
            compute: {
                S: { sku: 'D2s v5', month: 83.95 },
                M: { sku: 'D4s v5', month: 167.90 },
                L: { sku: 'D8s v5', month: 335.80 },
                XL: { sku: 'D16s v5', month: 671.60 },
            },
            db: { // PostgreSQL Flexible Server, General Purpose. HA assumed to bill a second server.
                S: { sku: 'D2ds v5', single: 154.76, ha: { v: 309.52, unverified: true, note: 'HA billed as 2x, inferred from docs.' } },
                M: { sku: 'D4ds v5', single: 309.52, ha: { v: 619.04, unverified: true, note: 'HA billed as 2x, inferred from docs.' } },
            },
            dbStorageGB: 0.1369, // doubled for HA
            objectGB: 0.0196, // Blob Hot LRS, first 50 TB
            blockGB: 0.0949, // Premium SSD v2
            natHour: 0.045, natGB: 0.045,
            lbMonth: 18.25,
            lbNote: 'Standard Load Balancer, first 5 rules; data processed ($0.005/GB) not included.',
            interRegionGB: 0.02, // intra-Europe
        },
        gcp: {
            label: 'Google Cloud', regionLabel: 'europe-west4 Netherlands', currency: 'USD', egressRegion: 'eu-west',
            // cloud.google.com pricing pages, region europe-west4
            compute: {
                S: { sku: 'n2-standard-2', month: 78.05 },
                M: { sku: 'n2-standard-4', month: 156.10 },
                L: { sku: 'n2-standard-8', month: 312.19 },
                XL: { sku: 'n2-standard-16', month: 624.39 },
            },
            db: { // Cloud SQL PostgreSQL Enterprise, zonal / regional HA
                S: { sku: '2 vCPU / 8 GB', single: 111.25, ha: 222.65 },
                M: { sku: '4 vCPU / 16 GB', single: 222.50, ha: 445.30 },
            },
            dbStorageGB: 0.187, // SSD; doubled for HA
            objectGB: 0.020, // Cloud Storage Standard regional
            blockGB: 0.110, // pd-balanced
            natHour: 0.044, natGB: 0.045, // gateway cap (>32 VMs); smaller setups pay $0.0014 per VM-hour
            lbMonth: 18.25,
            lbNote: 'External Application LB forwarding rule; data processed ($0.009/GB) not included.',
            interRegionGB: 0.02, // Europe <-> Europe
        },
    },

    // ---------- 02 Run: EU providers ----------
    providers: {
        hetzner: {
            label: 'Hetzner', regionLabel: 'Falkenstein / Nuremberg', currency: 'EUR',
            url: 'https://www.hetzner.com/cloud/', referral: '',
            // Dedicated vCPU (CCX), prices after the 15 Jun 2026 increase, incl. primary IPv4.
            compute: {
                S: { sku: 'CCX13', price: 43.49 },
                M: { sku: 'CCX23', price: 86.49 },
                L: { sku: 'CCX33', price: 138.99 },
                XL: { sku: 'CCX43', price: 276.49 },
            },
            computeNote: 'Dedicated-vCPU CCX plans at June 2026 prices. Shared CX plans are far cheaper but shown as unavailable for new orders; check CCX availability before you rely on this column.',
            db: null, // no managed PostgreSQL
            blockGB: 0.044,
            objectStorage: { base: 6.49, includedGB: 1024, perGB: 6.47 / 1024, note: '€6.49 base incl. 1 TB, then €6.47 per TB.' },
            egress: { includedGBPerVM: 20 * 1024, perGB: 1 / 1024, note: '20 TB included per server, €1 per TB above.' },
            nat: { price: 19.99, note: 'No NAT product: priced as a CPX22 VM per gateway (CX plans currently unavailable).' },
            lb: { sku: 'LB11', price: 7.49 },
            interRegion: { perGB: 0, note: 'Free between Falkenstein, Nuremberg and Helsinki (same network zone).' },
        },
        scaleway: {
            label: 'Scaleway', regionLabel: 'Paris (fr-par)', currency: 'EUR',
            url: 'https://www.scaleway.com/en/pricing/', referral: '',
            compute: {
                S: { sku: 'POP2-2C-8G', price: 53.66 },
                M: { sku: 'POP2-4C-16G', price: 107.31 },
                L: { sku: 'POP2-8C-32G', price: 211.70 },
                XL: { sku: 'POP2-16C-64G', price: 430.70 },
            },
            db: {
                S: { sku: 'DB-POP2-2C-8G', single: 104.68, ha: 160.16 },
                M: { sku: 'DB-POP2-4C-16G', single: 209.22, ha: 320.11 },
                storageGB: 0.0993, storagePerNode: true,
                note: 'Storage counted per node with HA (assumption, Scaleway does not say).',
            },
            blockGB: 0.0949,
            objectStorage: { perGB: 0.01606, note: 'Standard multi-AZ. Object egress: 75 GB free, then €0.01/GB.' },
            egress: { perGB: 0, note: 'Instance internet egress is included.' },
            nat: { price: 18.98 + 3.65, note: 'Public Gateway S plus IPv4.' },
            lb: { sku: 'LB-S', price: 16.79 + 0.005 * 730 },
            interRegion: { perGB: { v: 0, unverified: true }, note: 'No egress fees; inter-region traffic assumed free.' },
        },
        ovh: {
            label: 'OVHcloud', regionLabel: 'Public Cloud EU', currency: 'EUR',
            url: 'https://www.ovhcloud.com/en-ie/public-cloud/prices/', referral: '',
            compute: {
                S: { sku: 'b3-8', price: 37.38 },
                M: { sku: 'b3-16', price: 74.68 },
                L: { sku: 'b3-32', price: 149.36 },
                XL: { sku: 'b3-64', price: 298.72 },
            },
            db: {
                // Discovery = 1 node, Production = 2 nodes
                S: { sku: 'PostgreSQL b3-8', single: 143.23, ha: 325.58 },
                M: { sku: 'PostgreSQL b3-16', single: 286.38, ha: 651.30 },
                storageGB: 0,
                note: 'Includes 160 GB (b3-8) or 320 GB (b3-16) storage per node.',
            },
            blockGB: 0.086,
            objectStorage: { perGB: 0.0071, note: 'Standard 1-AZ, no egress or API fees.' },
            egress: { perGB: 0, note: 'Instance egress is included.' },
            nat: { price: 2.0, note: 'Gateway S (200 Mbps), price from OVH catalog API.' },
            lb: { sku: 'LB S', price: 6.0 },
            interRegion: { perGB: 0, note: 'Free over vRack and public egress in EU regions.' },
        },
        exoscale: {
            label: 'Exoscale', regionLabel: 'Frankfurt / Geneva', currency: 'EUR',
            url: 'https://www.exoscale.com/pricing/', referral: '',
            compute: {
                S: { sku: 'Standard Large (4/8)', price: 68.13 },
                M: { sku: 'Standard Extra-large (4/16)', price: 136.27 },
                L: { sku: 'Standard Huge (8/32)', price: 272.54 },
                XL: { sku: 'Standard Mega (12/64)', price: 545.07 },
            },
            computeNote: 'No 2 vCPU / 8 GB size; S maps to Large (4/8). Local disk extra at €0.1022/GB.',
            db: {
                // No 2/8 plan: S maps to the 4 vCPU / 8 GB plans. Startup = 1 node, Business = 2 nodes.
                S: { sku: 'Startup-8 / Business-8', single: 196.08, ha: 384.20 },
                M: { sku: 'Startup-16 / Business-16', single: 384.09, ha: 743.48 },
                storageGB: 0,
                note: 'Includes 175 GB (8 GB plans) or 350 GB (16 GB plans) per node.',
            },
            blockGB: 0.1022,
            objectStorage: { perGB: 0.0201, note: 'Simple Object Storage. Object egress €0.02/GB.' },
            egress: { includedGBPerVM: 1037, perGB: 0.02, note: '~1 TB free per instance per month, then €0.02/GB.' },
            nat: { price: 5.32, note: 'No NAT product: priced as a Micro VM per gateway.' },
            lb: { sku: 'NLB', price: 25.35 },
            interRegion: { perGB: 0, note: 'Traffic between Exoscale zones is free.' },
        },
    },

    // ---------- Data platforms ----------
    // ---------- Faster ways out than the public internet (EU regions, checked 2026-10-26) ----------
    // None of the free-egress-for-leaving programmes covers private links or devices: they are internet only.
    transfer: {
        linkGbps: 10,
        linkUtilisation: 0.8,
        crossConnect: { v: 250, unverified: true, note: 'colocation fibre cross-connect, about $200-350 a month' },
        euSide: { v: 753, unverified: true, note: 'carrier line from the cloud interconnect site to your own data centre or colo, about €650 a month for 10G (comparable to OVHcloud Connect Direct 10G at €649)' },
        euSideSetup: { v: 289, unverified: true, note: 'one-off line setup, about €250 (e.g. OVHcloud Connect setup fee €249)' },
        leadWeeks: { v: 4, unverified: true, note: 'dedicated port plus cross-connect: typically 2-8 weeks' },
        links: {
            // Source: aws.amazon.com/directconnect/pricing (+ flat-rate, from 2026-09-15); AWS Price List API eu-west-1
            aws: [
                { label: 'AWS Direct Connect 10G, pay as you go', monthly: 1642.5, perGB: 0.02 },
                { label: 'AWS Direct Connect 10G, flat rate (Tier 1)', monthly: 8001, perGB: 0 },
            ],
            // Source: Azure retail prices API, ExpressRoute Zone 1. Local needs the Amsterdam peering location.
            azure: [
                { label: 'Azure ExpressRoute 10G, metered', monthly: 3400, perGB: 0.025 },
                { label: 'Azure ExpressRoute Local 10G (Amsterdam)', monthly: 5500, perGB: 0 },
            ],
            // Source: cloud.google.com/network-connectivity/docs/interconnect/pricing. $0.02 per GiB, Europe to Europe.
            gcp: [
                { label: 'Google Dedicated Interconnect 10G', monthly: 1699 + 0.10 * 730, perGB: 0.02 },
            ],
        },
        devices: {
            aws: { available: false, text: 'AWS Snowball is no longer available to new customers. AWS Data Transfer Terminal is built for uploads and has no documented export.' },
            gcp: { available: false, text: 'Google Transfer Appliance can export only in the USA.' },
            // Source: learn.microsoft.com/azure/databox (export supported); Azure retail prices API, West Europe.
            azure: {
                available: true, label: 'Azure Data Box (120 TB devices)', deviceTB: 120, deviceFee: 350,
                turnaroundDays: { v: 14, unverified: true, note: 'order, copy in Azure, courier both ways' },
                text: 'Export is supported, but Azure still charges its normal egress on the data. Whether the leaving programme covers it is not confirmed, so it is not applied. You also need a site to plug the device in and upload to your EU provider.',
            },
        },
        tools: 'Copy tools: rclone (free, any S3 to any S3), AWS DataSync (adds $0.0125 per GB), Flexify.IO (paid, managed). Google Storage Transfer Service and Azure Storage Mover cannot write to non-hyperscaler storage.',
    },

    dataPlatforms: {
        snowflake: {
            note: 'Snowflake runs only on AWS, Azure and GCP. A STACKIT option was announced in Sep 2026 for data and keys only, with no GA date. EU-run replacements: managed ClickHouse on Scaleway or OVHcloud, or Trino on Iceberg. Iceberg tables on your own external volume are already Parquet in your bucket: exit is a bucket copy, but record each table\'s current metadata file first (SYSTEM$GET_ICEBERG_TABLE_INFORMATION). When unloading, raise MAX_FILE_SIZE (default 16 MB for Parquet) to avoid millions of tiny files.',
            keepNote: 'Kept as-is: still billed by Snowflake on a hyperscaler. Data flowing to and from your EU setup adds egress.',
            serviceKey: 'warehouse',
            replaceWith: { scaleway: 'Data Warehouse for ClickHouse', ovh: 'managed ClickHouse', default: 'self-hosted ClickHouse or Trino' },
            fileMB: 128,
            // Source: Snowflake Service Consumption Table, effective 2026-10-15.
            creditPrice: { standard: 2.60, enterprise: 3.90, businessCritical: 5.20 }, // on-demand, same in EU regions of all three clouds
            creditsPerHour: { M: 4, L: 8, XL: 16, '2XL': 32 }, // Standard (Gen 1) warehouse; Gen 2 uses 1.25-1.35x
            // No published unload benchmark. ~0.1 TB per credit (range 0.07-0.25), derived from Snowflake's own load test. Time a sample unload.
            unloadTBPerHour: { M: { v: 0.4, unverified: true }, L: { v: 0.8, unverified: true }, XL: { v: 1.6, unverified: true }, '2XL': { v: 3.2, unverified: true } },
            transferPerTB: { aws: 90, azure: 87.5, gcp: 120 }, // to internet or another cloud, from EU regions. Same-region unload is free.
        },
        databricks: {
            note: 'Databricks runs only on AWS, Azure and GCP, but your tables already sit in your own bucket as Delta (Parquet files). Open-source Spark, Trino and DuckDB read them directly. EU-run replacements: Scaleway Clusters for Apache Spark, OVHcloud Data Platform, or self-hosted Spark. Exception: serverless default storage sits in Databricks\' account, not yours, so those tables need a real export through Databricks compute.',
            keepNote: 'Kept as-is: still billed by Databricks on a hyperscaler. Data flowing to and from your EU setup adds egress.',
            serviceKey: 'spark',
            replaceWith: { scaleway: 'Clusters for Apache Spark', ovh: 'Data Platform (Spark, Trino)', default: 'self-hosted Spark and Trino' },
            fileMB: 128,
        },
    },

    // Rule of thumb per selected managed service, by how it maps on each EU provider.
    serviceEffort: {
        native: { days: 3, vms: 0 },
        partial: { days: 8, vms: 0 },
        none: { days: 15, vms: 2 }, // HA pair of small VMs per region
    },

    // ---------- Managed services: what maps where ----------
    // status: native = managed equivalent, partial = compatible or close, test it, none = self-host
    services: [
        { key: 'k8s', label: 'Kubernetes (EKS / AKS / GKE)', map: {
            hetzner: ['none', 'Self-managed k3s or Talos'],
            scaleway: ['native', 'Kapsule'],
            ovh: ['native', 'Managed Kubernetes'],
            exoscale: ['native', 'SKS'],
        } },
        { key: 'faas', label: 'Functions (Lambda / Azure Functions / Cloud Run)', map: {
            hetzner: ['none', 'Knative or OpenFaaS on k8s'],
            scaleway: ['native', 'Serverless Functions & Containers'],
            ovh: ['none', 'Knative on Managed Kubernetes'],
            exoscale: ['none', 'Knative on SKS'],
        } },
        { key: 'nosql', label: 'Key-value NoSQL (DynamoDB / Cosmos DB / Firestore)', map: {
            hetzner: ['none', 'Self-host ScyllaDB or FoundationDB'],
            scaleway: ['none', 'Self-host ScyllaDB, or redesign on PostgreSQL'],
            ovh: ['none', 'Self-host ScyllaDB, or redesign on PostgreSQL'],
            exoscale: ['none', 'Self-host ScyllaDB, or redesign on PostgreSQL'],
        } },
        { key: 'queue', label: 'Queues & pub/sub (SQS, SNS / Service Bus / Pub/Sub)', map: {
            hetzner: ['none', 'Self-host RabbitMQ or NATS'],
            scaleway: ['native', 'Queues (SQS API), Topics & Events (SNS API)'],
            ovh: ['partial', 'Managed Kafka'],
            exoscale: ['partial', 'Managed Kafka'],
        } },
        { key: 'cache', label: 'Redis cache (ElastiCache / Azure Cache / Memorystore)', map: {
            hetzner: ['none', 'Self-host Valkey'],
            scaleway: ['native', 'Managed Redis'],
            ovh: ['native', 'Managed Valkey'],
            exoscale: ['native', 'Managed Valkey'],
        } },
        { key: 'search', label: 'Search (OpenSearch / AI Search)', map: {
            hetzner: ['none', 'Self-host OpenSearch'],
            scaleway: ['partial', 'Cloud Essentials for OpenSearch, check availability'],
            ovh: ['native', 'Managed OpenSearch'],
            exoscale: ['native', 'Managed OpenSearch'],
        } },
        { key: 'warehouse', label: 'Data warehouse (Redshift / Synapse / BigQuery / Snowflake)', map: {
            hetzner: ['none', 'Self-host ClickHouse or StarRocks'],
            scaleway: ['native', 'Data Warehouse for ClickHouse'],
            ovh: ['native', 'Managed ClickHouse'],
            exoscale: ['none', 'Self-host ClickHouse'],
        } },
        { key: 'spark', label: 'Spark / lakehouse (EMR / Databricks / Dataproc)', map: {
            hetzner: ['none', 'Self-host Spark + Iceberg + Trino'],
            scaleway: ['native', 'Clusters for Apache Spark'],
            ovh: ['partial', 'Data Platform (Iceberg, Spark, Trino), pricing coming soon'],
            exoscale: ['none', 'Self-host Spark on SKS'],
        } },
        { key: 'kafka', label: 'Kafka (MSK / Event Hubs / Managed Kafka)', map: {
            hetzner: ['none', 'Self-host Kafka or Redpanda'],
            scaleway: ['native', 'Clusters for Apache Kafka'],
            ovh: ['native', 'Managed Kafka'],
            exoscale: ['native', 'Managed Kafka'],
        } },
        { key: 'cdn', label: 'CDN (CloudFront / Front Door / Cloud CDN)', map: {
            hetzner: ['partial', 'External EU CDN, e.g. Bunny.net'],
            scaleway: ['native', 'Edge Services'],
            ovh: ['partial', 'External EU CDN, e.g. Bunny.net'],
            exoscale: ['partial', 'External EU CDN, e.g. Bunny.net'],
        } },
        { key: 'idp', label: 'Identity (Cognito / Entra External ID / Identity Platform)', map: {
            hetzner: ['none', 'Keycloak or Zitadel'],
            scaleway: ['none', 'Keycloak or Zitadel'],
            ovh: ['none', 'Keycloak or Zitadel'],
            exoscale: ['none', 'Keycloak or Zitadel'],
        } },
        { key: 'secrets', label: 'Secrets & KMS', map: {
            hetzner: ['none', 'OpenBao or Vault'],
            scaleway: ['native', 'Secret Manager & Key Manager'],
            ovh: ['native', 'KMS & Secret Manager'],
            exoscale: ['none', 'OpenBao or Vault'],
        } },
    ],
};
