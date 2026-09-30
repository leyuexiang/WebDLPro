/**
 * 源文件逐项审计生成的不可变清单：每条路径对应一个独立完整输入，
 * 展平组合图元 ID 和工艺图元 ID 均按源 pen ID 明确登记，不依赖标题或坐标猜测。
 */
export const BUSINESS_SCENE_TOPOLOGY_SOURCE_MANIFEST = {
  "microgrid": [
    {
      "id": "architecture",
      "combinationKey": "architecture",
      "layerIds": [
        "architecture"
      ],
      "topologyPath": "variants/architecture/topology.json",
      "sourceSha256": "63f35445d6d7eee546f9ff796363dfedbc540a8b2cfd97828cd95667c7bb872a",
      "expectedPenCount": 49,
      "expectedRuntimePenCount": 46,
      "flattenedCombines": [
        {
          "id": "eea38",
          "directChildCount": 1
        },
        {
          "id": "2e6d362",
          "directChildCount": 7
        },
        {
          "id": "6c191ab",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "89e489",
        "2cb1d5e6",
        "8c3a8af",
        "709425c",
        "18dfaea9",
        "dc771da",
        "14803c75",
        "a5f6452"
      ]
    },
    {
      "id": "network",
      "combinationKey": "network",
      "layerIds": [
        "network"
      ],
      "topologyPath": "variants/network/topology.json",
      "sourceSha256": "5789834dc6c782cb370d94c703bf362c89824b6bcbb6cb4c077fe30a7b71b919",
      "expectedPenCount": 45,
      "expectedRuntimePenCount": 42,
      "flattenedCombines": [
        {
          "id": "31985ad1",
          "directChildCount": 1
        },
        {
          "id": "74f883ed",
          "directChildCount": 7
        },
        {
          "id": "3290d1b",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "business",
      "combinationKey": "business",
      "layerIds": [
        "business"
      ],
      "topologyPath": "variants/business/topology.json",
      "sourceSha256": "a055e8ff4c9c2fb00c97145664f69766ff99512f9bd656c13e826099c8a4658d",
      "expectedPenCount": 30,
      "expectedRuntimePenCount": 27,
      "flattenedCombines": [
        {
          "id": "0e3f2c8",
          "directChildCount": 1
        },
        {
          "id": "ebec2dd",
          "directChildCount": 7
        },
        {
          "id": "4c235ebe",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "c3bd3e2",
        "34b9a797",
        "73975c89",
        "de68659",
        "6e5072c3",
        "34229b3",
        "161b9b1",
        "10009b95"
      ]
    },
    {
      "id": "key-process",
      "combinationKey": "key-process",
      "layerIds": [
        "key-process"
      ],
      "topologyPath": "variants/key-process/topology.json",
      "sourceSha256": "0fec248981e4101b049c9fd2aaa359f1ce0b3ae5bf6eeb914b0a79f20871256d",
      "expectedPenCount": 28,
      "expectedRuntimePenCount": 25,
      "flattenedCombines": [
        {
          "id": "09eba33",
          "directChildCount": 1
        },
        {
          "id": "191ba9d6",
          "directChildCount": 7
        },
        {
          "id": "32205c0e",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-key-process",
      "combinationKey": "network+key-process",
      "layerIds": [
        "network",
        "key-process"
      ],
      "topologyPath": "variants/network-key-process/topology.json",
      "sourceSha256": "debffa4a234a9135f12d3981e9d294b94cc62a63cc6fcbaac670c2f4d15cbf3f",
      "expectedPenCount": 58,
      "expectedRuntimePenCount": 55,
      "flattenedCombines": [
        {
          "id": "8d55ccb",
          "directChildCount": 1
        },
        {
          "id": "7aeff842",
          "directChildCount": 7
        },
        {
          "id": "3801ccf0",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-business",
      "combinationKey": "network+business",
      "layerIds": [
        "network",
        "business"
      ],
      "topologyPath": "variants/network-business/topology.json",
      "sourceSha256": "ef5803a9a47b00f0d38d7cd70518427705e4cfeb8d135fc27bf57e32614b6e73",
      "expectedPenCount": 60,
      "expectedRuntimePenCount": 57,
      "flattenedCombines": [
        {
          "id": "2dd179d1",
          "directChildCount": 1
        },
        {
          "id": "535713c",
          "directChildCount": 7
        },
        {
          "id": "9989a24",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "115ead",
        "a1c0e9f",
        "b98c8fe",
        "51db7fc",
        "5df8986",
        "5d097",
        "383ef1e5",
        "bd36216"
      ]
    },
    {
      "id": "business-key-process",
      "combinationKey": "business+key-process",
      "layerIds": [
        "business",
        "key-process"
      ],
      "topologyPath": "variants/business-key-process/topology.json",
      "sourceSha256": "99c4a92e3ae73cf36280299460c16d37ac9b91b294b83037009ee3775846fef3",
      "expectedPenCount": 49,
      "expectedRuntimePenCount": 46,
      "flattenedCombines": [
        {
          "id": "d0811de",
          "directChildCount": 1
        },
        {
          "id": "6fea1e",
          "directChildCount": 7
        },
        {
          "id": "57a907e6",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "8dd99af",
        "9b09b35",
        "1af96f6",
        "2557f9e",
        "7b3b6c77",
        "86e0fe8",
        "00905b7",
        "2cc6d198"
      ]
    },
    {
      "id": "network-business-key-process",
      "combinationKey": "network+business+key-process",
      "layerIds": [
        "network",
        "business",
        "key-process"
      ],
      "topologyPath": "variants/network-business-key-process/topology.json",
      "sourceSha256": "8e5056ebb00da3095ce9f8709c048bd4fa5f9e995c93b928d96932cbb911c67a",
      "expectedPenCount": 79,
      "expectedRuntimePenCount": 75,
      "flattenedCombines": [
        {
          "id": "f5323bc",
          "directChildCount": 64
        },
        {
          "id": "5f9a8ad5",
          "directChildCount": 1
        },
        {
          "id": "6f383601",
          "directChildCount": 7
        },
        {
          "id": "308e0b",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "3451fb7",
        "40bc26a1",
        "5026136",
        "64455435",
        "e893cf3",
        "fa1adb7",
        "040d6da",
        "2bedebf2"
      ],
      "isDefault": true
    }
  ],
  "distribution": [
    {
      "id": "architecture",
      "combinationKey": "architecture",
      "layerIds": [
        "architecture"
      ],
      "topologyPath": "variants/architecture/topology.json",
      "sourceSha256": "31cb4d7b991c4389809844cf20c2511b0f2b59147c4be6355b3ab334131a6e73",
      "expectedPenCount": 56,
      "expectedRuntimePenCount": 54,
      "flattenedCombines": [
        {
          "id": "c6d4a9e",
          "directChildCount": 2
        },
        {
          "id": "646474f1",
          "directChildCount": 12
        }
      ],
      "processPenIds": [
        "610bd33",
        "14bb7271",
        "54ada3bb",
        "67be591f",
        "36892602",
        "41a57681"
      ]
    },
    {
      "id": "network",
      "combinationKey": "network",
      "layerIds": [
        "network"
      ],
      "topologyPath": "variants/network/topology.json",
      "sourceSha256": "29196857f55bddb2f47f0f5f0c7915651fd58c413018909affe2e05e880319d4",
      "expectedPenCount": 76,
      "expectedRuntimePenCount": 75,
      "flattenedCombines": [
        {
          "id": "26da1b90",
          "directChildCount": 7
        }
      ],
      "processPenIds": []
    },
    {
      "id": "business",
      "combinationKey": "business",
      "layerIds": [
        "business"
      ],
      "topologyPath": "variants/business/topology.json",
      "sourceSha256": "f93d4808d1e05b710076474888c58037f3b8d234fa97cec5bb70ad0252452088",
      "expectedPenCount": 26,
      "expectedRuntimePenCount": 25,
      "flattenedCombines": [
        {
          "id": "ec0fc60",
          "directChildCount": 7
        }
      ],
      "processPenIds": [
        "2f4d19a3",
        "0f9d67d",
        "5372084",
        "f4d23ed",
        "60ce7f9b",
        "18bc01ed"
      ]
    },
    {
      "id": "key-process",
      "combinationKey": "key-process",
      "layerIds": [
        "key-process"
      ],
      "topologyPath": "variants/key-process/topology.json",
      "sourceSha256": "97ce2aa379a4c21824d34ee291061934208b3948c7f05752b37a7dcdd39fe0b6",
      "expectedPenCount": 43,
      "expectedRuntimePenCount": 42,
      "flattenedCombines": [
        {
          "id": "3d353b97",
          "directChildCount": 7
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-key-process",
      "combinationKey": "network+key-process",
      "layerIds": [
        "network",
        "key-process"
      ],
      "topologyPath": "variants/network-key-process/topology.json",
      "sourceSha256": "f2bfddad4c6d03193d4041eb25fcfeec26e64b394a19fb6753d477e72bb157bd",
      "expectedPenCount": 76,
      "expectedRuntimePenCount": 75,
      "flattenedCombines": [
        {
          "id": "0fdc9fa",
          "directChildCount": 7
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-business",
      "combinationKey": "network+business",
      "layerIds": [
        "network",
        "business"
      ],
      "topologyPath": "variants/network-business/topology.json",
      "sourceSha256": "ea111ca170273108a8e886ed6a5f7336d8d3ef923f86df61f2312dbf05813772",
      "expectedPenCount": 87,
      "expectedRuntimePenCount": 86,
      "flattenedCombines": [
        {
          "id": "621b9d8a",
          "directChildCount": 7
        }
      ],
      "processPenIds": [
        "56167f2",
        "29c2f4",
        "5862ea60",
        "a952b33",
        "1ffc135c",
        "324c58c"
      ]
    },
    {
      "id": "business-key-process",
      "combinationKey": "business+key-process",
      "layerIds": [
        "business",
        "key-process"
      ],
      "topologyPath": "variants/business-key-process/topology.json",
      "sourceSha256": "b3794b4684842ddd6a6a98b5e1550e2f779849c6ab13f8e8a038110154bd0db4",
      "expectedPenCount": 55,
      "expectedRuntimePenCount": 53,
      "flattenedCombines": [
        {
          "id": "70688ba8",
          "directChildCount": 1
        },
        {
          "id": "5ed2a7e",
          "directChildCount": 7
        }
      ],
      "processPenIds": [
        "7d7326c8",
        "941fb09",
        "3729c135",
        "dd1c8e8",
        "f8d3292",
        "b0fc8fe"
      ]
    },
    {
      "id": "network-business-key-process",
      "combinationKey": "network+business+key-process",
      "layerIds": [
        "network",
        "business",
        "key-process"
      ],
      "topologyPath": "variants/network-business-key-process/topology.json",
      "sourceSha256": "d4e0850f65569f1b09015a17bfb232562c6c32367ad423ed5239bcd292c730cd",
      "expectedPenCount": 98,
      "expectedRuntimePenCount": 96,
      "flattenedCombines": [
        {
          "id": "3bed2cda",
          "directChildCount": 84
        },
        {
          "id": "816c33",
          "directChildCount": 7
        }
      ],
      "processPenIds": [
        "61d434d9",
        "7b392c50",
        "9bd8a30",
        "3589a2d1",
        "267620",
        "1053df92"
      ],
      "isDefault": true
    }
  ],
  "consumption": [
    {
      "id": "architecture",
      "combinationKey": "architecture",
      "layerIds": [
        "architecture"
      ],
      "topologyPath": "variants/architecture/topology.json",
      "sourceSha256": "f0c1477c06a84cda9ad24894b1aae9e146eea1b808876273fca9e16d2069992b",
      "expectedPenCount": 38,
      "expectedRuntimePenCount": 35,
      "flattenedCombines": [
        {
          "id": "2cb1921",
          "directChildCount": 1
        },
        {
          "id": "dad12fc",
          "directChildCount": 7
        },
        {
          "id": "6426caf0",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "7a066c0",
        "272193e6",
        "7ff3581d",
        "6658cc9e"
      ]
    },
    {
      "id": "network",
      "combinationKey": "network",
      "layerIds": [
        "network"
      ],
      "topologyPath": "variants/network/topology.json",
      "sourceSha256": "dace4dda8ac02062afc2651958bcb5ec46706d0c5cd9f8e0eff49d1e19f82470",
      "expectedPenCount": 44,
      "expectedRuntimePenCount": 41,
      "flattenedCombines": [
        {
          "id": "1c2f069",
          "directChildCount": 1
        },
        {
          "id": "bb6aab4",
          "directChildCount": 7
        },
        {
          "id": "5269661",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "business",
      "combinationKey": "business",
      "layerIds": [
        "business"
      ],
      "topologyPath": "variants/business/topology.json",
      "sourceSha256": "5f575ae28464e5d191ec000ac0a18b2dd669f882864f4ccf3fee4a569bc4a839",
      "expectedPenCount": 23,
      "expectedRuntimePenCount": 20,
      "flattenedCombines": [
        {
          "id": "197062f0",
          "directChildCount": 1
        },
        {
          "id": "64541",
          "directChildCount": 7
        },
        {
          "id": "6e40c947",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "5aa0c403",
        "265e901b",
        "70e773e",
        "087d9c4"
      ]
    },
    {
      "id": "key-process",
      "combinationKey": "key-process",
      "layerIds": [
        "key-process"
      ],
      "topologyPath": "variants/key-process/topology.json",
      "sourceSha256": "6619c9c62039e72485b701ed53a2092cead39d3e1d82d0644d4610b4107335c7",
      "expectedPenCount": 26,
      "expectedRuntimePenCount": 22,
      "flattenedCombines": [
        {
          "id": "fdfc0b0",
          "directChildCount": 1
        },
        {
          "id": "bbb44a4",
          "directChildCount": 1
        },
        {
          "id": "24866a3",
          "directChildCount": 7
        },
        {
          "id": "d59c70",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-key-process",
      "combinationKey": "network+key-process",
      "layerIds": [
        "network",
        "key-process"
      ],
      "topologyPath": "variants/network-key-process/topology.json",
      "sourceSha256": "583e4881a6f29da66b57aabbf244a45b5527f7bcf2c3659669a1f1ecbccb8589",
      "expectedPenCount": 50,
      "expectedRuntimePenCount": 47,
      "flattenedCombines": [
        {
          "id": "5a89944",
          "directChildCount": 1
        },
        {
          "id": "4edfd59a",
          "directChildCount": 7
        },
        {
          "id": "d917eae",
          "directChildCount": 6
        }
      ],
      "processPenIds": []
    },
    {
      "id": "network-business",
      "combinationKey": "network+business",
      "layerIds": [
        "network",
        "business"
      ],
      "topologyPath": "variants/network-business/topology.json",
      "sourceSha256": "5ff080b707b35a859aea0ccc595d4045c970b8840ebaa11a448662dfcc48e6c9",
      "expectedPenCount": 51,
      "expectedRuntimePenCount": 48,
      "flattenedCombines": [
        {
          "id": "6cb7731",
          "directChildCount": 1
        },
        {
          "id": "c98f455",
          "directChildCount": 7
        },
        {
          "id": "42e052dd",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "d54f950",
        "8be9096",
        "dc939db",
        "5a3d1dc"
      ]
    },
    {
      "id": "business-key-process",
      "combinationKey": "business+key-process",
      "layerIds": [
        "business",
        "key-process"
      ],
      "topologyPath": "variants/business-key-process/topology.json",
      "sourceSha256": "a396e48c91b42235db242bce38c1c730cdfd434acb9b3b355857e89e9de4f3f1",
      "expectedPenCount": 32,
      "expectedRuntimePenCount": 29,
      "flattenedCombines": [
        {
          "id": "5cb59537",
          "directChildCount": 1
        },
        {
          "id": "2522c7f9",
          "directChildCount": 7
        },
        {
          "id": "63777b36",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "5726a9c1",
        "68c6a715",
        "318b0c36",
        "1b8d3554"
      ]
    },
    {
      "id": "network-business-key-process",
      "combinationKey": "network+business+key-process",
      "layerIds": [
        "network",
        "business",
        "key-process"
      ],
      "topologyPath": "variants/network-business-key-process/topology.json",
      "sourceSha256": "4fd1d494b3c659b60c63a9ee5107ed8098f37e7f3812b39b98aee7ec5d027394",
      "expectedPenCount": 57,
      "expectedRuntimePenCount": 54,
      "flattenedCombines": [
        {
          "id": "8954bdb",
          "directChildCount": 1
        },
        {
          "id": "75dcfa53",
          "directChildCount": 7
        },
        {
          "id": "084b4",
          "directChildCount": 6
        }
      ],
      "processPenIds": [
        "c3964cf",
        "20e2131b",
        "23e8722",
        "34f3f54f"
      ],
      "isDefault": true
    }
  ]
} as const
